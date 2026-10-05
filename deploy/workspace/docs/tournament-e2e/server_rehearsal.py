"""Prepare/start a test listener in existing host Nginx. Never cut over production."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import uuid

PROJECT = 'backgammon-rehearsal-20261005t184922z'
HOST = '38.247.146.17.nip.io'
ORIGIN = f'https://{HOST}:18443'
TAG = 'bg-20261005-git-r2'
SERVICES = {'game-api': 'game', 'game-tasks': 'game', 'game-migrate': 'game',
            'tournaments-api': 'tournaments', 'tournaments-tasks': 'tournaments',
            'tournaments-migrate': 'tournaments', 'dice': 'dice',
            'game-frontend': 'game-frontend', 'tournaments-frontend': 'tournaments-frontend',
            'admin-frontend': 'admin-frontend'}
APPS = ['dice', 'game-api', 'tournaments-api', 'game-frontend', 'tournaments-frontend', 'admin-frontend']
WORKERS = ['game-tasks', 'tournaments-tasks']
CONF = Path('/etc/nginx/conf.d/backgammon-rehearsal-e2e.conf')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(args, capture=False, environment=None):
    result = subprocess.run([str(item) for item in args], check=True, text=True,
                            env=environment, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def docker(*args, capture=False):
    return run(['sudo', 'docker', *args], capture=capture)


def write(file, value, private=True):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700 if private else 0o755)
    encoded = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(encoded)
    file.chmod(0o600 if private else 0o644)


def inspect(service):
    # Select only identity/state fields. Never dump a container environment.
    return json.loads(docker('inspect', f'{PROJECT}-{service}-1', '--format',
        '{"image":{{json .Image}},"status":{{json .State.Status}},'
        '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}""{{end}},'
        '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
        '"service":{{json (index .Config.Labels "com.docker.compose.service")}}}', capture=True))


def harness_inventory(tools):
    files = sorted(file.name for file in tools.iterdir() if file.is_file()
                   and file.suffix in ('.mjs', '.py', '.ps1', '.Dockerfile'))
    digest = hashlib.sha256()
    for name in files:
        digest.update((name + '\0').encode())
        digest.update((tools / name).read_bytes())
    return files, digest.hexdigest()


def prepare(args, state, tools):
    require(not state.exists(), 'Test state already exists; use start/check with this same session, not prepare again')
    run(['python3', args.project / 'docker/verify_workspace.py'])
    built = json.loads((args.project / '.built-images.json').read_text())
    require(built['image_tag'] == TAG and len(built['sources']) == 4, 'Expected verified R2 images')
    for image, value in built['images'].items():
        actual = docker('image', 'inspect', value['name'], '--format', '{{.Id}}', capture=True)
        require(actual == value['id'], f'Built image changed: {image}')
    for service in ('postgres', 'redis'):
        value = inspect(service)
        require(value['project'] == PROJECT and value['health'] == 'healthy', 'Existing rehearsal infrastructure is not healthy')
    network = json.loads(docker('network', 'inspect', PROJECT + '_application', capture=True))[0]
    require(network['Internal'] is True, 'The copied rehearsal network must remain internal')
    gateways = [item.get('Gateway') for item in network['IPAM']['Config'] if item.get('Gateway')]
    gateway = next((item for item in gateways if ipaddress.ip_address(item).version == 4), None)
    require(gateway, 'Rehearsal bridge has no IPv4 host gateway')
    socket_output = run(['sudo', 'ss', '-lntH'], capture=True)
    require(not any(re.search(r':18443\s', line) for line in socket_output.splitlines()), 'Test port 18443 is already in use')
    require(not CONF.exists(), 'An existing test Nginx configuration must not be overwritten')
    state.mkdir(mode=0o700)
    (state / 'audit').mkdir(mode=0o700)
    run(['sudo', 'chgrp', '10001', state / 'audit'])
    (state / 'audit').chmod(0o770)
    session_id = uuid.uuid4().hex
    identity = {'schema_version': 1, 'project': PROJECT, 'origin': ORIGIN, 'session_id': session_id,
                'image_tag': TAG, 'sources': built['sources'],
                'images': {key: value['id'] for key, value in built['images'].items()}}
    files, identity['harness_sha256'] = harness_inventory(tools)
    admin = {'username': 'E2EAdmin_' + session_id[:12], 'password': secrets.token_urlsafe(36)}
    session = {'identity': identity, 'admin': admin, 'harness_files': files,
               'project_dir': str(args.project), 'rehearsal_dir': str(args.rehearsal),
               'gateway': gateway, 'tools_dir': str(tools)}
    write(state / 'session.json', session)
    # Host parent remains 0700; bind-mounted individual files must be readable by app UID 10001.
    (state / 'session.json').chmod(0o644)
    ticket, result, command, analysis = [secrets.token_urlsafe(48) for _ in range(4)]
    for kind in ('game', 'tournaments'):
        values = {'SECRET_KEY': secrets.token_urlsafe(48), 'GAMELINK_ENABLED': '1',
                  'ANALYSIS_API_TOKEN': analysis, 'ANALYSIS_SERVICE_URL': '', 'AI_SERVICE_URL': '',
                  'EMAIL_BACKEND': 'django.core.mail.backends.dummy.EmailBackend',
                  'WEB_PUSH_PUBLIC_KEY': '', 'WEB_PUSH_PRIVATE_KEY': '',
                  'TRANZILA_ENABLED': '0', 'TRANZILA_PURCHASES_ENABLED': '0',
                  'GOOGLE_CLIENT_ID': '', 'APP_LOG_LEVEL': 'INFO'}
        if kind == 'game':
            values.update(GAMELINK_TICKET_SECRETS=ticket, GAMELINK_RESULT_SECRET=result,
                          GAMELINK_COMMAND_SECRETS=command)
        else:
            values.update(GAMELINK_TICKET_SECRET=ticket, GAMELINK_RESULT_SECRETS=result,
                          GAMELINK_COMMAND_SECRET=command)
        write(state / f'{kind}.json', values)
        (state / f'{kind}.json').chmod(0o644)
    overrides = {'services': {}}
    for service, image in SERVICES.items():
        values = {'image': built['images'][image]['id'], 'pull_policy': 'never'}
        if service.startswith(('game-', 'tournaments-')) and service not in ('game-frontend', 'tournaments-frontend'):
            kind = 'game' if service.startswith('game-') else 'tournaments'
            values.update(user='10001:10001', extra_hosts={HOST: gateway}, environment={'RUNTIME_CONFIG_FILE': f'/opt/e2e/{kind}.json'}, volumes=[
                {'type': 'bind', 'source': str(state / f'{kind}.json'), 'target': f'/opt/e2e/{kind}.json', 'read_only': True},
                {'type': 'bind', 'source': str(state / 'session.json'), 'target': '/opt/e2e/session.json', 'read_only': True},
                {'type': 'bind', 'source': str(tools / 'rehearsal_app.py'), 'target': '/opt/e2e/rehearsal_app.py', 'read_only': True},
                {'type': 'bind', 'source': str(state / 'audit'), 'target': '/data/e2e-audit'},
            ])
        overrides['services'][service] = values
    write(state / 'compose.e2e.json', overrides)
    write(state / 'source-images.json', built)
    finish_prepare(args, state, tools, session)


def finish_prepare(args, state, tools, session):
    identity = session['identity']
    require(not CONF.exists(), 'A test listener is already installed')
    if (state / 'server-client.json').exists():
        require((state / 'nginx.candidate.conf').is_file() and (state / 'identity.json').is_file(),
                'Client manifest exists but test preparation is incomplete')
        print('Test preparation already completed; use start or check.')
        return
    # Keep the public engine outside private backups; no credential file is served.
    output = state / 'engine'
    builder = 'backgammon-build-' + TAG
    try:
        docker('buildx', 'inspect', builder, '--bootstrap')
        limits = docker('inspect', f'buildx_buildkit_{builder}0', '--format',
                        '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}', capture=True)
        require(limits == '3221225472 3221225472 100000 100000', 'Engine builder resource limits differ from R2')
        docker('buildx', 'build', '--builder', builder, '--file', tools / 'remote-engine.Dockerfile',
               '--output', f'type=local,dest={output}', args.project)
    finally:
        docker('buildx', 'stop', builder)
    engine = output / 'engine.js'
    # The local exporter is invoked with sudo and can create a root-owned 0700 directory.
    # Repair only its two known artifacts; never recurse into the rehearsal backup.
    run(['sudo', 'test', '-d', output])
    run(['sudo', 'test', '!', '-L', output])
    run(['sudo', 'test', '-f', engine])
    run(['sudo', 'test', '!', '-L', engine])
    run(['sudo', 'chown', '--no-dereference', f'{os.getuid()}:{os.getgid()}', '--', output, engine])
    output.chmod(0o700)
    engine.chmod(0o600)
    require(engine.is_file(), 'Pure game helper was not built')
    identity['engine_sha256'] = hashlib.sha256(engine.read_bytes()).hexdigest()
    # A retry can follow a Git fix before the private client manifest is issued.
    session['harness_files'], identity['harness_sha256'] = harness_inventory(tools)
    # These are exclusively public bytes; root installs them to a traversable path.
    session['identity'] = identity
    (state / 'session.json').write_text(json.dumps(session, indent=2) + '\n')
    identity_file = state / 'identity.json'
    if identity_file.exists():
        require(not identity_file.is_symlink() and json.loads(identity_file.read_text())['session_id'] == identity['session_id'],
                'Public identity artifact belongs to another session')
        identity_file.write_text(json.dumps(identity, indent=2) + '\n')
    else:
        write(identity_file, identity)
    public = Path('/var/lib/backgammon-e2e') / identity['session_id']
    run(['sudo', 'install', '-d', '-m', '0755', public])
    run(['sudo', 'install', '-m', '0644', engine, public / 'engine.js'])
    run(['sudo', 'install', '-m', '0644', state / 'identity.json', public / 'identity.json'])
    candidate = state / 'nginx.candidate.conf'
    if candidate.exists():
        require(not candidate.is_symlink() and 'Session ' + identity['session_id'] in candidate.read_text(),
                'Nginx candidate belongs to another session')
        candidate.write_text(nginx(identity))
    else:
        write(candidate, nginx(identity))
    write(state / 'server-client.json', {'identity': identity, 'admin': session['admin'], 'harness_files': session['harness_files']})
    print(f'Prepared test session: {identity["session_id"]}\nPrivate browser manifest: {state / "server-client.json"}')
    print('Application images unchanged. No application service or test Nginx listener has been started.')


def nginx(identity):
    public = Path('/var/lib/backgammon-e2e') / identity['session_id']
    def proxy(prefix, port, target=None, websocket=False):
        return f'''location {prefix} {{
    proxy_pass http://127.0.0.1:{port}{target or ''};
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    {'proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";' if websocket else ''}
}}'''
    routes = [proxy('/backgammon/api/', 18005, '/api/'), proxy('/backgammon/ws/', 18005, '/ws/', True),
              proxy('/api/link/', 18005, '/api/link/'), proxy('/api/gamelink/', 18006, '/api/gamelink/'),
              proxy('/tournaments-api/', 18006, '/api/'), proxy('/tournaments-ws/', 18006, '/ws/', True),
              proxy('/tournaments-play/', 18006, '/t/'), proxy('/api/admin/', 18006, '/api/admin/'),
              proxy('/tournaments-accounts/', 18006, '/accounts/'),
              proxy('/tournaments-django-admin/', 18006, '/admin/'),
              proxy('/backgammon/', 18105), proxy('/tournaments/', 18106), proxy('/tournaments-admin/', 18108),
              proxy('/tournaments-static/', 18106), proxy('/tournaments-media/', 18106)]
    return f'''# Session {identity['session_id']}; temporary rehearsal only.
server {{
  listen 18443 ssl;
  server_name {HOST};
  ssl_certificate /etc/letsencrypt/live/{HOST}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/{HOST}/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
  # Log path only, omitting signed ticket query strings.
  access_log off;
  location = /__e2e__/identity {{ default_type application/json; alias {public}/identity.json; add_header Cache-Control "no-store"; }}
  location = /backgammon/__e2e__/engine.js {{ default_type application/javascript; alias {public}/engine.js; }}
  location = /backgammon {{ return 301 /backgammon/; }}
  location = /tournaments {{ return 301 /tournaments/; }}
  {' '.join(routes)}
  location / {{ return 404; }}
}}
'''


def compose(args, state, *command, capture=False):
    environment = dict(os.environ, TRANSFER_DIR=str(args.rehearsal / 'transfer-v2'),
                       PUBLIC_HOST=HOST, PUBLIC_ORIGIN=ORIGIN)
    return run(['sudo', 'env', f'TRANSFER_DIR={environment["TRANSFER_DIR"]}', f'PUBLIC_HOST={HOST}',
                f'PUBLIC_ORIGIN={ORIGIN}', 'docker', 'compose', '--profile', 'operations', '--profile', 'live',
                '--profile', 'workers', '--profile', 'tournament-workers',
                '--env-file', args.project / 'docker/production.env', '-p', PROJECT,
                '-f', args.project / 'docker/compose.production.yaml',
                '-f', args.rehearsal / 'compose.override.yaml', '-f', state / 'compose.e2e.json', *command], capture=capture)


def verify_config(args, state):
    config = json.loads(compose(args, state, 'config', '--format', 'json', capture=True))
    require(config['name'] == PROJECT and config['networks']['application']['internal'] is True,
            'Expected the isolated copied rehearsal project')
    require(not config['services']['postgres'].get('ports') and not config['services']['redis'].get('ports'),
            'Database/cache ports must not be published')
    session = json.loads((state / 'session.json').read_text())
    require(session['project_dir'] == str(args.project) and session['rehearsal_dir'] == str(args.rehearsal),
            'Session paths differ from the prepared target')
    for service, image in SERVICES.items():
        require(config['services'][service]['image'] == session['identity']['images'][image], 'Application image differs from verified R2')
        if service.startswith(('game-', 'tournaments-')) and service not in ('game-frontend', 'tournaments-frontend'):
            env = config['services'][service]['environment']
            kind = 'game' if service.startswith('game-') else 'tournaments'
            require(env['DB_HOST'] == 'postgres' and env['DB_NAME'] == 'backgammon_' + kind,
                    'Application database is outside the copied rehearsal')
            key = 'GAMELINK_TOURNAMENTS_URL' if kind == 'game' else 'GAMELINK_BACKGAMMON_URL'
            require(env[key] == ORIGIN, 'Callback origin differs from the test Nginx listener')
    return session


def verify_live(session):
    for service in APPS + WORKERS:
        state = inspect(service)
        require(state['project'] == PROJECT and state['service'] == service and state['status'] == 'running'
                and state['image'] == session['identity']['images'][SERVICES[service]], f'Wrong running container: {service}')
        if service in APPS:
            require(state['health'] == 'healthy', f'Unhealthy application: {service}')


def app(args, state, kind, action):
    compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate',
            'python', '/opt/e2e/rehearsal_app.py', kind, action)


def check_listener(session):
    # Force the local host gateway without relying on public hairpin routing.
    identity = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '10', '--resolve',
                    f'{HOST}:18443:127.0.0.1', ORIGIN + '/__e2e__/identity'], capture=True)
    require(json.loads(identity) == session['identity'], 'Nginx listener has an unexpected identity')


def monitoring(state, tools):
    active = Path('/etc/alloy-config.hcl')
    original = run(['sudo', 'cat', active], capture=True) + '\n'
    require('BACKGAMMON REHEARSAL DOCKER LOGS' not in original, 'Rehearsal log collector already installed')
    start = original.index('prometheus.relabel "backgammon_containers" {')
    opening = original.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        depth += (original[end] == '{') - (original[end] == '}')
        end += 1
    block = original[start:end]
    block, count = re.subn(r'regex\s*=\s*"backgammon-production"',
                          'regex = "backgammon-production|' + PROJECT + '"', block)
    require(count == 1, 'Unexpected container metrics project filter')
    block, count = re.subn(r'rule\s*\{\s*target_label\s*=\s*"stack"\s*replacement\s*=\s*"backgammon-production"\s*\}',
        'rule {\n    source_labels = ["container_label_com_docker_compose_project"]\n    target_label = "stack"\n  }', block)
    require(count == 1, 'Unexpected container metrics stack labels')
    logs = (tools.parent.parent / 'docker/alloy.backgammon-docker.hcl').read_text()
    logs = logs.replace('backgammon_production', 'backgammon_rehearsal').replace('backgammon-production', PROJECT)
    logs = logs.replace('BACKGAMMON DOCKER LOGS', 'BACKGAMMON REHEARSAL DOCKER LOGS')
    candidate = original[:start] + block + original[end:] + '\n' + logs
    backup = state / 'alloy.before-rehearsal.hcl'
    write(backup, original)
    write(state / 'alloy.candidate.hcl', candidate)
    executable = '/opt/alloy/alloy-linux-amd64'
    run(['sudo', executable, 'validate', state / 'alloy.candidate.hcl'])
    run(['sudo', 'install', '-m', '0600', state / 'alloy.candidate.hcl', active])
    try:
        run(['sudo', 'systemctl', 'restart', 'alloy.service'])
        run(['systemctl', 'is-active', 'alloy.service'])
    except Exception:
        run(['sudo', 'install', '-m', '0600', backup, active])
        run(['sudo', 'systemctl', 'restart', 'alloy.service'])
        raise
    print('Rehearsal logs and container metrics collector installed. Verify fresh data in Grafana; configuration success alone is not delivery proof.')
    print('Loki selector: {stack="' + PROJECT + '"}')
    print('Prometheus selector: container_memory_working_set_bytes{stack="' + PROJECT + '"}')


def restore_monitoring(state):
    active = Path('/etc/alloy-config.hcl')
    current = run(['sudo', 'cat', active], capture=True)
    require(current.strip() == (state / 'alloy.candidate.hcl').read_text().strip(),
            'Alloy has other changes after rehearsal setup; refusing to overwrite them')
    backup = state / 'alloy.before-rehearsal.hcl'
    run(['sudo', '/opt/alloy/alloy-linux-amd64', 'validate', backup])
    run(['sudo', 'install', '-m', '0600', backup, active])
    run(['sudo', 'systemctl', 'restart', 'alloy.service'])
    run(['systemctl', 'is-active', 'alloy.service'])
    print('Rehearsal monitoring additions removed; the previous collectors restored.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'finish-prepare', 'start', 'check', 'baseline', 'monitoring', 'monitoring-restore', 'audit', 'stop'))
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--rehearsal', required=True, type=Path)
    parser.add_argument('--summary', type=Path)
    args = parser.parse_args()
    args.project, args.rehearsal = args.project.resolve(), args.rehearsal.resolve()
    require(args.project.name == TAG and args.rehearsal.name == 'docker-rehearsal'
            and args.rehearsal.parent.name == 'rehearsal-20261005T184922Z', 'Unexpected release or rehearsal directory')
    tools = Path(__file__).resolve().parent
    state = args.rehearsal / 'browser-e2e-r2'
    if args.action == 'prepare':
        prepare(args, state, tools)
        return
    session = verify_config(args, state)
    if args.action == 'finish-prepare':
        finish_prepare(args, state, tools, session)
        return
    if args.action == 'monitoring-restore':
        restore_monitoring(state)
        return
    if args.action == 'start':
        require(not CONF.exists(), 'Test listener is already installed; use check instead of starting twice')
        for service in APPS + WORKERS:
            exists = docker('ps', '-aq', '--filter', f'label=com.docker.compose.project={PROJECT}',
                            '--filter', f'label=com.docker.compose.service={service}', capture=True)
            if exists:
                old = inspect(service)
                require(old['project'] == PROJECT and old['service'] == service
                        and old['image'] == session['identity']['images'][SERVICES[service]],
                        'Existing rehearsal container belongs to a different release')
        # Retry a partially completed setup only within this pinned rehearsal.
        compose(args, state, 'stop', *WORKERS, *APPS)
        for kind in ('game', 'tournaments'):
            compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate')
        app(args, state, 'tournaments', 'seed')
        for kind in ('game', 'tournaments'):
            app(args, state, kind, 'baseline')
        compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--no-recreate', '--wait', '--wait-timeout', '180', *APPS)
        # No public-production Nginx block is edited. Only this new test file is installed.
        run(['sudo', 'install', '-m', '0644', state / 'nginx.candidate.conf', CONF])
        try:
            run(['sudo', 'nginx', '-t'])
            run(['sudo', 'systemctl', 'reload', 'nginx'])
            check_listener(session)
            for kind in ('game', 'tournaments'):
                compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate',
                    'python', '-c', 'import json,urllib.request; '
                    'target=json.load(open("/opt/e2e/session.json"))["identity"]; '
                    'assert json.load(urllib.request.urlopen(target["origin"]+"/__e2e__/identity",timeout=10))==target; '
                    'print("Container HTTPS callback route verified.")')
            compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--no-recreate', *WORKERS)
            verify_live(session)
        except Exception:
            run(['sudo', 'rm', '--', CONF])
            run(['sudo', 'nginx', '-t'])
            run(['sudo', 'systemctl', 'reload', 'nginx'])
            compose(args, state, 'stop', *WORKERS, *APPS)
            raise
        print(f'TEST ENTRY READY: {ORIGIN}/tournaments/\nExisting production HTTPS port 443 and its services are unchanged.')
        return
    if args.action == 'stop':
        if CONF.exists():
            contents = run(['sudo', 'cat', CONF], capture=True)
            require('Session ' + session['identity']['session_id'] in contents, 'Test configuration belongs to another session')
            run(['sudo', 'rm', '--', CONF])
            run(['sudo', 'nginx', '-t'])
            run(['sudo', 'systemctl', 'reload', 'nginx'])
        compose(args, state, 'stop', *WORKERS, *APPS)
        print('Only rehearsal browser services stopped. PostgreSQL, Redis, copied data and production services preserved.')
        return
    verify_live(session)
    check_listener(session)
    if args.action == 'baseline':
        for kind in ('game', 'tournaments'):
            app(args, state, kind, 'baseline')
        print('Idle baseline ready. Start a NEW browser run before refreshing this baseline again.')
        return
    if args.action == 'check':
        compose(args, state, 'ps')
        print('R2 container identities, health and host Nginx test listener verified.')
        return
    if args.action == 'monitoring':
        monitoring(state, tools)
        return
    require(args.summary and args.summary.is_file(), 'Pass the completed browser tournament-summary.json')
    summary = json.loads(args.summary.read_text(encoding='utf-8'))
    require(summary.get('targetSession') == session['identity']['session_id']
            and re.fullmatch(r'[A-Za-z0-9_-]{10,80}', summary.get('runId', '')), 'Invalid uploaded browser run')
    destination = state / 'audit/tournament-summary.json'
    if destination.exists():
        destination.unlink()
    write(destination, summary)
    destination.chmod(0o644)
    app(args, state, 'game', 'audit')
    app(args, state, 'tournaments', 'audit')
    app(args, state, 'game', 'replay')
    app(args, state, 'tournaments', 'audit')
    print('SERVER DATABASE AND DUPLICATE-RESULT AUDIT PASSED. Combine with the browser performance acceptance report.')


if __name__ == '__main__':
    main()
