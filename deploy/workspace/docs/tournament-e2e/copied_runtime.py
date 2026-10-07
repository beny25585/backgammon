"""Provision private runtime settings for a copied candidate before browser load."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import time
import uuid

import server_rehearsal as server

APIS = ('game-api', 'tournaments-api', 'analysis-api')
NEW_WORKERS = ('tournaments-tasks', 'push-worker')
ISOLATION_OVERLAY = '''services:
  game-api:
    ports: !reset []
  tournaments-api:
    ports: !reset []
  analysis-api:
    ports: !reset []
'''

KEY_CODE = '''
import base64, json
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
key = ec.generate_private_key(ec.SECP256R1())
encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
print(json.dumps({
    'WEB_PUSH_PRIVATE_KEY': encode(key.private_numbers().private_value.to_bytes(32, 'big')),
    'WEB_PUSH_PUBLIC_KEY': encode(key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint))
}))
'''

RUNTIME_CHECK = '''
import json, django
django.setup()
from django.conf import settings
from frontend.push import configured
assert not settings.TRANZILA_ENABLED and not settings.TRANZILA_PURCHASES_ENABLED, 'Payments must be disabled'
assert settings.EMAIL_BACKEND == 'django.core.mail.backends.dummy.EmailBackend', 'Email must be disabled'
assert configured() and settings.WEB_PUSH_SUBJECT == 'https://38.247.146.17.nip.io:18443', 'Test Push must be configured'
assert settings.GOOGLE_CLIENT_ID, 'Google client ID must be configured'
print('Candidate runtime checks passed')
'''

DATABASE_CHECK = '''
import json, os, django
django.setup()
from django.conf import settings
database = settings.DATABASES['default']
print(json.dumps({'DB_NAME': database['NAME'], 'DB_HOST': database['HOST'], 'DB_USER': database['USER'],
    'REDIS_URL': os.environ.get('REDIS_URL'),
    'GAMELINK_BACKGAMMON_URL': os.environ.get('GAMELINK_BACKGAMMON_URL'),
    'GAMELINK_TOURNAMENTS_URL': os.environ.get('GAMELINK_TOURNAMENTS_URL')}))
'''


def private_settings(original, keys, origin):
    server.require(isinstance(original, dict) and all(isinstance(value, str) for value in original.values()),
                   'Runtime configuration must contain string values')
    server.require(set(keys) == {'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'}
                   and all(isinstance(value, str) and value for value in keys.values()), 'Missing new Push keys')
    server.require(keys['WEB_PUSH_PUBLIC_KEY'] != original.get('WEB_PUSH_PUBLIC_KEY')
                   and keys['WEB_PUSH_PRIVATE_KEY'] != original.get('WEB_PUSH_PRIVATE_KEY'), 'Push keys must be new')
    return dict(original, **keys, WEB_PUSH_SUBJECT=origin,
                EMAIL_BACKEND='django.core.mail.backends.dummy.EmailBackend',
                TRANZILA_ENABLED='0', TRANZILA_PURCHASES_ENABLED='0')


def secret_source(config, service, destination):
    sources = []
    item = config['services'][service]
    for secret in item.get('secrets', []):
        target = PurePosixPath(secret.get('target') or secret['source'])
        target = target if target.is_absolute() else PurePosixPath('/run/secrets') / target
        if str(target) == destination:
            sources.append((secret['source'], config['secrets'][secret['source']]['file']))
    server.require(len(sources) == 1 and not any(volume.get('target') == destination
                   for volume in item.get('volumes', [])), 'Ambiguous runtime secret mount')
    return sources[0]


def runtime_overlay(images, secret, configuration):
    services = {name: {'image': images[server.SERVICES[name]], 'pull_policy': 'never'}
                for name in APIS + NEW_WORKERS}
    for name in ('tournaments-api', 'push-worker'):
        services[name]['networks'] = ['application', 'integrations_egress']
    return {'services': services, 'secrets': {secret: {'file': str(configuration)}},
            'networks': {'integrations_egress': {'internal': False}}}


def listener_content(original, before, after):
    server.require(set(before) == set(after) == set(server.UPSTREAM_PORTS), 'Incomplete listener addresses')
    server.require(len(re.findall(r'\blisten\s+18443\s+ssl;', original)) == 1
                   and not re.search(r'\blisten\s+(?:443|80)\b', original)
                   and original.count('server {') == 1, 'Unexpected test listener structure')
    replacements = {}
    for service in server.UPSTREAM_PORTS:
        source = 'http://' + before[service]
        # Exact host/port boundary prevents matching a longer port or other target.
        server.require(re.search(re.escape(source) + r'(?=[/;\s])', original),
                       'Listener does not use the current candidate: ' + service)
        replacements[source] = 'http://' + after[service]
    pattern = '|'.join(re.escape(value) for value in replacements)
    return re.sub('(?:' + pattern + r')(?=[/;\s])', lambda match: replacements[match.group()], original)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def private_read(file):
    return server.run(['sudo', 'cat', file], capture=True)


def container(service):
    return json.loads(server.docker('inspect', server.PROJECT + '-' + service + '-1', capture=True))[0]


def compose(args, files, *command, capture=False):
    return server.run(['sudo', 'env', 'IMAGE_TAG=' + args.project.name,
        'PUBLIC_HOST=' + server.HOST, 'PUBLIC_ORIGIN=' + server.ORIGIN,
        'TRANSFER_DIR=' + str(args.rehearsal / 'transfer-v2'), 'docker', 'compose',
        '--env-file', args.project / 'docker/production.env', '-p', server.PROJECT,
        '--profile', 'live', '--profile', 'operations', '--profile', 'workers', '--profile', 'tournament-workers',
        *(item for file in files for item in ('-f', str(file))), *command], capture=capture)


def addresses(images, network):
    result = {}
    for service in server.UPSTREAM_PORTS:
        value = container(service)
        labels = value['Config']['Labels']
        server.require(labels['com.docker.compose.project'] == server.PROJECT
                       and labels['com.docker.compose.service'] == service
                       and value['Image'] == images[server.SERVICES[service]]
                       and value['State']['Status'] == 'running'
                       and value['State']['Health']['Status'] == 'healthy', 'Unexpected candidate upstream: ' + service)
        connections = value['NetworkSettings']['Networks']
        allowed = {network['Name']}
        if service == 'tournaments-api':
            allowed.add(server.PROJECT + '_integrations_egress')
        server.require(network['Name'] in connections and set(connections) <= allowed
                       and connections[network['Name']]['NetworkID'] == network['Id'], 'Unexpected API network')
        result[service] = connections[network['Name']]['IPAddress']
    return server.upstreams_for_addresses(result, [item['Subnet'] for item in network['IPAM']['Config']])


def wait_apis(images):
    deadline = time.monotonic() + 180
    while True:
        healthy = True
        for name in APIS:
            value = server.inspect(name)
            server.require(value['project'] == server.PROJECT and value['service'] == name
                           and value['image'] == images[server.SERVICES[name]], 'Candidate API identity changed')
            healthy &= value['status'] == 'running' and value['health'] == 'healthy'
        if healthy:
            return
        server.require(time.monotonic() < deadline, 'Candidate API health timeout')
        time.sleep(3)


def install_listener(state, original, before, after, name, allowed_current):
    destination = state / name
    server.write(destination, listener_content(original, before, after))
    server.require(private_read(server.CONF) in allowed_current, 'Test listener changed concurrently; retained ' + str(state))
    server.run(['sudo', 'install', '-m', '0644', destination, server.CONF])
    server.run(['sudo', 'nginx', '-t'])
    server.run(['sudo', 'systemctl', 'reload', 'nginx'])


def check_runtime():
    server.docker('exec', server.PROJECT + '-tournaments-api-1', 'python',
                  '/opt/docker/runtime_env.py', 'python', '-c', RUNTIME_CHECK)


def verify_plan(config, base, images, secret, configuration, network_internal=True):
    server.require(config['name'] == base['name'] == server.PROJECT
                   and config['networks']['application'].get('internal', False) is network_internal, 'Candidate network differs')
    for name, item in config['services'].items():
        previous = base['services'][name]
        server.require(item.get('environment') == previous.get('environment')
                       and item.get('volumes') == previous.get('volumes')
                       and (not item.get('ports') if name in APIS else item.get('ports') == previous.get('ports')),
                       'Service context changed: ' + name)
        expected_networks = {'application', 'integrations_egress'} if name in ('tournaments-api', 'push-worker') else set(previous['networks'])
        server.require(set(item['networks']) == expected_networks
                       and ('integrations_egress' not in item['networks'] or name in ('tournaments-api', 'push-worker')),
                       'Unexpected integration network membership')
    server.require(config['networks']['integrations_egress'].get('internal', False) is False, 'Missing integration egress')
    for name in APIS + NEW_WORKERS:
        server.require(config['services'][name]['image'] == images[server.SERVICES[name]]
                       and not config['services'][name].get('ports'), 'Candidate image/ports differ')
    for name, item in config['secrets'].items():
        server.require(item == ({**base['secrets'][name], 'file': str(configuration)} if name == secret else base['secrets'][name]),
                       'Other candidate secret changed')


def prepare(args):
    args.project, args.rehearsal = args.project.resolve(strict=True), args.rehearsal.resolve(strict=True)
    args.copied_load = True
    target = server.configure_target(args)
    # Only the existing, explicitly selected copied candidate and published source are accepted.
    tools = Path(__file__).resolve().parent
    repository = server.MANAGED_ROOT / 'sources/backgammon'
    server.require(tools == repository / 'deploy/workspace/docs/tournament-e2e'
                   and re.fullmatch(r'[a-f0-9]{40}', args.tools_revision), 'Unexpected runtime tool source')
    git = ['git', '-c', 'safe.directory=' + str(repository), '-C', repository]
    server.require(server.run([*git, 'rev-parse', 'HEAD'], capture=True) == args.tools_revision
                   and not server.run([*git, 'status', '--porcelain', '--untracked-files=all'], capture=True),
                   'Runtime preparation requires the exact clean published commit')
    server.run(['python3', args.project / 'docker/verify_workspace.py'])
    server.SERVICES.update({'analysis-api': 'analysis', 'push-worker': 'tournaments'})
    built = json.loads((args.project / '.built-images.json').read_text())
    images = {kind: value['id'] for kind, value in built['images'].items()}
    server.require(built['image_tag'] == target['image_tag'] and built['sources'] == target['sources'], 'Candidate image inventory differs')
    network, network_context = server.verify_copied_network(target)
    network_identity = dict(target, network_context=network_context)
    state = args.rehearsal / 'copied-runtime'
    server.require(not state.is_symlink(), 'Unsafe runtime preparation directory')
    if state.exists():
        receipt = json.loads((state / 'receipt.json').read_text())
        server.require(receipt['validation_id'] == target['validation_id'], 'Runtime state belongs to another candidate')
        if receipt['status'] == 'ready':
            server.require(receipt.get('network_context') == network_context
                           and digest(private_read(state / 'tournaments.json')) == receipt['configuration_sha256']
                           and digest((state / 'compose.runtime.json').read_text().strip()) == receipt['overlay_sha256']
                           and (state / 'compose.isolation.yaml').read_text() == ISOLATION_OVERLAY, 'Prepared runtime files changed')
            for name in ('tournaments-api',) + NEW_WORKERS:
                value = container(name)
                server.require(value['Image'] == images['tournaments'] and value['State']['Status'] == 'running'
                               and any(mount['Source'] == str(state / 'tournaments.json') for mount in value['Mounts']),
                               'Private runtime is not active: ' + name)
            check_runtime()
            print('COPIED RUNTIME ALREADY READY; run prepare-load with this tools revision')
            return
        server.require(receipt['status'] == 'restored', 'Incomplete runtime preparation; inspect retained ' + str(state))
        server.require(not (args.rehearsal / 'browser-load').exists(), 'Browser load already has state; do not change its runtime')
        state.rename(state.with_name('copied-runtime-restored-' + uuid.uuid4().hex))
    server.require(not (args.rehearsal / 'browser-load').exists(), 'Browser load already has state; do not change its runtime')
    before = addresses(images, network)
    files = None
    for name in APIS:
        value = container(name)
        server.require(value['Image'] == images[server.SERVICES[name]] and value['State']['Health']['Status'] == 'healthy', 'Candidate API differs')
        selected = [Path(file).resolve(strict=True) for file in value['Config']['Labels']['com.docker.compose.project.config_files'].split(',')]
        server.require(all(file.is_relative_to(args.project) or file.is_relative_to(args.rehearsal) for file in selected)
                       and (files is None or selected == files), 'Candidate APIs use different/outside Compose files')
        files = selected
    for name in NEW_WORKERS:
        server.require(not server.docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + server.PROJECT,
                       '--filter', 'label=com.docker.compose.service=' + name, capture=True), 'Worker already exists: ' + name)
    base = json.loads(compose(args, files, 'config', '--format', 'json', capture=True))
    server.require_copied_network_config(network_identity, base)
    context = {'purpose': 'copied-browser-e2e', 'databases': {}, 'markers': {}, 'redis_databases': {}}
    for name in APIS:
        value = container(name)
        tagged = server.docker('image', 'inspect', base['services'][name]['image'], '--format', '{{.Id}}', capture=True)
        server.require(tagged == images[server.SERVICES[name]], 'Original API image tag changed; cannot guarantee restoration')
        env = dict(item.split('=', 1) for item in value['Config']['Env'])
        expected = base['services'][name]['environment']
        for key in ('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD_FILE', 'RUNTIME_CONFIG_FILE', 'DJANGO_SETTINGS_MODULE'):
            server.require(env[key] == expected[key], 'Base Compose differs from API: ' + key)
        for key in ('GAMELINK_BACKGAMMON_URL', 'GAMELINK_TOURNAMENTS_URL', 'REDIS_URL'):
            if key in expected:
                server.require(env[key] == expected[key], 'Base Compose endpoint differs')
        effective = json.loads(server.docker('exec', server.PROJECT + '-' + name + '-1', 'python',
            '/opt/docker/runtime_env.py', 'python', '-c', DATABASE_CHECK, capture=True))
        for key in ('DB_HOST', 'DB_NAME', 'DB_USER', 'REDIS_URL', 'GAMELINK_BACKGAMMON_URL', 'GAMELINK_TOURNAMENTS_URL'):
            if key in expected:
                server.require(effective[key] == expected[key], 'Loaded runtime context differs: ' + key)
        server.require(env['DB_HOST'] == 'postgres' and env['DB_USER'] == 'backgammon_' + server.SERVICES[name], 'API database context differs')
        kind = server.SERVICES[name]
        server.require(re.fullmatch(r'[a-z][a-z0-9_]{0,62}', env['DB_NAME']), 'Unsafe candidate database name')
        catalog = json.loads(server.postgres_query('postgres',
            "SELECT json_build_object('owner',pg_get_userbyid(datdba),'marker',shobj_description(oid,'pg_database')) "
            f"FROM pg_database WHERE datname='{env['DB_NAME']}'"))
        server.require(catalog['owner'] == 'backgammon_' + kind, 'Candidate database owner differs')
        context['databases'][kind], context['markers'][kind] = env['DB_NAME'], catalog['marker']
        if kind != 'analysis':
            callback = 'GAMELINK_TOURNAMENTS_URL' if kind == 'game' else 'GAMELINK_BACKGAMMON_URL'
            server.require(env[callback] == server.ORIGIN, 'Candidate callback is outside the test listener')
            redis = re.fullmatch(r'redis://redis:6379/(\d+)', env['REDIS_URL'])
            server.require(redis, 'Unexpected candidate Redis URL')
            context['redis_databases'][kind] = int(redis[1])
        mounts = {mount['Destination']: mount['Source'] for mount in value['Mounts']}
        for key in ('RUNTIME_CONFIG_FILE', 'DB_PASSWORD_FILE'):
            _, source = secret_source(base, name, env[key])
            server.run(['sudo', 'test', source, '-ef', mounts[env[key]]])
    api_environment = base['services']['tournaments-api']['environment']
    server.require_browser_database_context(dict(target, session_id=uuid.uuid4().hex,
        load_cleanup_version=1, tools_revision=args.tools_revision, database_context=context))
    server.require(api_environment['GAMELINK_BACKGAMMON_URL'] == server.ORIGIN, 'Callbacks must use the test listener')
    for name in NEW_WORKERS:
        for key in ('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD_FILE', 'RUNTIME_CONFIG_FILE',
                    'DJANGO_SETTINGS_MODULE', 'GAMELINK_BACKGAMMON_URL', 'REDIS_URL'):
            server.require(base['services'][name]['environment'][key] == api_environment[key], 'Worker runtime context differs: ' + key)
        for key in ('DB_PASSWORD_FILE', 'RUNTIME_CONFIG_FILE'):
            server.require(secret_source(base, name, api_environment[key])
                           == secret_source(base, 'tournaments-api', api_environment[key]), 'Worker secret differs from API')
    for name in ('postgres', 'redis'):
        value = server.inspect(name)
        server.require(value['project'] == server.PROJECT and value['service'] == name
                       and value['status'] == 'running' and value['health'] == 'healthy', 'Candidate database/cache differs')
    secret, source = secret_source(base, 'tournaments-api', api_environment['RUNTIME_CONFIG_FILE'])
    original_configuration = private_read(source)
    original_settings = json.loads(original_configuration)
    keys = json.loads(server.docker('exec', server.PROJECT + '-tournaments-api-1', 'python', '-c', KEY_CODE, capture=True))
    settings = private_settings(original_settings, keys, server.ORIGIN)
    original_listener = private_read(server.CONF)
    listener_content(original_listener, before, before)
    overlay = runtime_overlay(images, secret, state / 'tournaments.json')
    state.mkdir(mode=0o700)
    server.write(state / 'tournaments.json', settings)
    server.run(['sudo', 'chown', '10001:10001', state / 'tournaments.json'])
    server.run(['sudo', 'chmod', '0400', state / 'tournaments.json'])
    server.write(state / 'compose.runtime.json', overlay)
    server.write(state / 'compose.isolation.yaml', ISOLATION_OVERLAY)
    server.write(state / 'listener.before.conf', original_listener)
    receipt = {'validation_id': target['validation_id'], 'status': 'staged', 'base_files': list(map(str, files)),
               'network_context': network_context,
               'configuration_sha256': digest(private_read(state / 'tournaments.json')),
               'overlay_sha256': digest((state / 'compose.runtime.json').read_text().strip())}
    receipt_file = state / 'receipt.json'
    server.write(receipt_file, receipt)
    modified_files = [*files, state / 'compose.isolation.yaml', state / 'compose.runtime.json']
    changed = False
    try:
        config = json.loads(compose(args, modified_files, 'config', '--format', 'json', capture=True))
        verify_plan(config, base, images, secret, state / 'tournaments.json', network_context['internal'])
        server.require_copied_network_config(network_identity, config)
        # Pin APIs to the existing images; all three receive the same recorded Compose files.
        changed = True
        compose(args, modified_files, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', *APIS)
        wait_apis(images)
        check_runtime()
        install_listener(state, original_listener, before, addresses(images, network), 'listener.runtime.conf', {original_listener})
        compose(args, modified_files, 'up', '-d', '--no-build', '--no-deps', *NEW_WORKERS)
        time.sleep(6)
        for name in NEW_WORKERS:
            value = server.inspect(name)
            server.require(value['project'] == server.PROJECT and value['service'] == name
                           and value['image'] == images['tournaments'] and value['status'] == 'running', 'Candidate worker failed: ' + name)
            server.require(any(mount['Source'] == str(state / 'tournaments.json')
                               and mount['Destination'] == api_environment['RUNTIME_CONFIG_FILE']
                               for mount in container(name)['Mounts']), 'Worker private configuration is missing')
        server.require(private_read(source) == original_configuration, 'Shared runtime file changed during preparation')
        server.verify_copied_network(network_identity)
        receipt['status'] = 'ready'
    except BaseException:
        if changed:
            # Remove only workers this operation was allowed to create. Never remove volumes.
            compose(args, modified_files, 'rm', '--stop', '--force', *NEW_WORKERS)
            compose(args, files, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', *APIS)
            wait_apis(images)
            forward = state / 'listener.runtime.conf'
            allowed = {original_listener, forward.read_text().strip()} if forward.exists() else {original_listener}
            install_listener(state, original_listener, before, addresses(images, network), 'listener.restored.conf', allowed)
        receipt['status'] = 'restored'
        receipt_file.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        raise
    receipt_file.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print('COPIED RUNTIME READY: private mail/Push configuration and two workers; run prepare-load')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--rehearsal', type=Path, required=True)
    parser.add_argument('--tools-revision', required=True)
    prepare(parser.parse_args())


if __name__ == '__main__':
    main()
