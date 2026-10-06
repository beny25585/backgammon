"""Enable all application services in the existing disposable browser rehearsal."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import uuid

from rehearsal_context import fresh_database_context, require_fresh_database_context

ANALYSIS_URL = 'http://analysis-api:8000'
ARTIFACTS = ('session.json', 'identity.json', 'server-client.json', 'compose.e2e.json',
             'nginx.candidate.conf', 'game.json', 'tournaments.json')
ANALYSIS_SERVICES = ('analysis-api', 'analysis-worker', 'analysis-migrate')
NETWORK_OVERLAY = '''services:
  analysis-api:
    ports: !reset []
  push-worker:
    networks: !override [application, integrations_egress]
  tournaments-api:
    networks: !override [application, integrations_egress]
networks:
  integrations_egress:
    internal: false
'''


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integration_context(identity):
    require_fresh_database_context(identity)
    return {'analysis_database': 'backgammon_analysis_e2e_' + identity['session_id'][:12],
            'analysis_url': ANALYSIS_URL, 'push_key_scope': 'browser-e2e'}


def require_integration_context(identity):
    if 'integrations' not in identity:
        require('integration_context' not in identity, 'Integration context requires explicit activation')
        return None
    require(identity['integrations'] == {'analysis': True, 'push': True, 'ai': True, 'google': True},
            'Unsupported integration activation')
    expected = integration_context(identity)
    require(identity.get('integration_context') == expected, 'Unexpected integration database or URL')
    return expected


def verify_integration_config(identity, config):
    context = require_integration_context(identity)
    if context is None:
        return
    for service in ANALYSIS_SERVICES:
        values = config['services'][service]
        env = values['environment']
        require(env['DB_HOST'] == 'postgres' and env['DB_NAME'] == context['analysis_database']
                and env['DB_USER'] == 'backgammon_analysis'
                and env['RUNTIME_CONFIG_FILE'] == '/opt/e2e/analysis.json',
                'Analysis must use its dedicated browser database and configuration')
        require(not values.get('ports') and set(values['networks']) == {'application'},
                'Analysis must remain on the internal application network without published ports')
    push = config['services']['push-worker']
    require(set(push['networks']) == {'application', 'integrations_egress'} and not push.get('ports'),
            'Push worker requires the dedicated egress network')
    require(set(config['services']['tournaments-api']['networks']) == {'application', 'integrations_egress'},
            'Google token verification requires outbound access from the tournament API')
    require(config['networks']['integrations_egress'].get('internal', False) is False,
            'Push delivery requires outbound access')
    for name, values in config['services'].items():
        require('integrations_egress' not in values.get('networks', {}) or name in ('push-worker', 'tournaments-api'),
                'Unexpected service on the integration egress network')


def read(path):
    require(path.is_file() and not path.is_symlink(), 'Missing or unsafe rehearsal artifact: ' + str(path))
    return json.loads(path.read_text())


def save(path, value, mode=0o644):
    require(not path.is_symlink(), 'Unsafe configuration path')
    with path.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
    path.chmod(mode)


def candidate(session, overrides, state, tools, session_id=None):
    require(require_integration_context(session['identity']) is None, 'Integrations are already enabled')
    updated, config = copy.deepcopy(session), copy.deepcopy(overrides)
    updated['identity']['session_id'] = session_id or uuid.uuid4().hex
    updated['identity']['integrations'] = {'analysis': True, 'push': True, 'ai': True, 'google': True}
    updated['identity']['database_context'] = fresh_database_context(updated['identity']['session_id'], integrations=True)
    updated['admin'] = {'username': 'E2EAdmin_' + updated['identity']['session_id'][:12],
                        'password': secrets.token_urlsafe(36)}
    context = integration_context(updated['identity'])
    updated['identity']['integration_context'] = context
    updated['tools_dir'] = str(tools)
    fresh = updated['identity']['database_context']
    for service, values in config['services'].items():
        if service in ('game-api', 'game-tasks', 'game-migrate', 'tournaments-api', 'tournaments-tasks', 'tournaments-migrate'):
            kind = 'game' if service.startswith('game-') else 'tournaments'
            values['environment'].update(DB_NAME=fresh['databases'][kind],
                REDIS_URL=f'redis://redis:6379/{fresh["redis_databases"][kind]}')
    for service in ANALYSIS_SERVICES:
        config['services'][service] = {
            'image': session['identity']['images']['analysis'], 'pull_policy': 'never', 'user': '10001:10001',
            'cpus': 1.0, 'environment': {'DB_NAME': context['analysis_database'],
                                       'RUNTIME_CONFIG_FILE': '/opt/e2e/analysis.json'},
            'volumes': [
                {'type': 'bind', 'source': str(state / 'analysis.json'), 'target': '/opt/e2e/analysis.json', 'read_only': True},
                {'type': 'bind', 'source': str(state / 'session.json'), 'target': '/opt/e2e/session.json', 'read_only': True},
                {'type': 'bind', 'source': str(state / 'audit'), 'target': '/data/e2e-audit'},
                *({'type': 'bind', 'source': str(tools / name), 'target': '/opt/e2e/' + name, 'read_only': True}
                  for name in ('rehearsal_context.py', 'rehearsal_integrations.py'))],
        }
    config['services']['push-worker'] = copy.deepcopy(config['services']['tournaments-tasks'])
    # The command/memory limit still come from production Compose, not a parallel worker.
    return updated, config


def prepare_database(rehearsal, identity, kind='analysis'):
    require(kind in ('game', 'tournaments', 'analysis'), 'Unexpected browser database kind')
    context = require_fresh_database_context(identity)
    name = integration_context(identity)['analysis_database'] if kind == 'analysis' else context['databases'][kind]
    owner_role = 'backgammon_' + kind
    marker = 'backgammon-browser-e2e:' + identity['session_id'] + ':' + kind
    role = json.loads(rehearsal.postgres_query('postgres',
        "SELECT json_build_object('login', rolcanlogin, 'superuser', rolsuper, "
        "'createdb', rolcreatedb, 'createrole', rolcreaterole) "
        f"FROM pg_roles WHERE rolname = '{owner_role}'"))
    require(role == {'login': True, 'superuser': False, 'createdb': False, 'createrole': False},
            'Expected the existing unprivileged analysis role')
    result = rehearsal.postgres_query('postgres',
        "SELECT json_build_object('owner', pg_get_userbyid(datdba), 'marker', shobj_description(oid, 'pg_database')) "
        f"FROM pg_database WHERE datname = '{name}'")
    if not result:
        rehearsal.postgres_query('postgres', f'CREATE DATABASE "{name}" OWNER "{owner_role}" TEMPLATE template0')
        owner, existing_marker = owner_role, None
    else:
        existing = json.loads(result)
        owner, existing_marker = existing['owner'], existing['marker']
    require(owner == owner_role and existing_marker in (None, marker), 'Browser database identity changed')
    if existing_marker is None:
        require(rehearsal.postgres_query(name, "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'") == '0',
                'Refusing to adopt an unmarked nonempty analysis database')
        rehearsal.postgres_query('postgres', f"COMMENT ON DATABASE \"{name}\" IS '{marker}'")
    rehearsal.postgres_query('postgres', f'REVOKE ALL ON DATABASE "{name}" FROM PUBLIC')


def server_action(rehearsal, args, tools, action):
    command = ['python3', str(tools / 'server_rehearsal.py'), action,
               '--project', str(args.project), '--rehearsal', str(args.rehearsal)]
    if action != 'start':
        rehearsal.run(command)
        return
    # Preserve the first child failure even when rollback removes its containers.
    state = args.rehearsal / 'browser-e2e-r2'
    directory = state / 'activation-logs'
    require(not directory.is_symlink(), 'Unsafe activation log directory')
    directory.mkdir(mode=0o700, exist_ok=True)
    file = directory / ('start-' + uuid.uuid4().hex + '.private.log')
    with file.open('x', encoding='utf-8') as log:
        file.chmod(0o600)
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, bufsize=1) as child:
            for line in child.stdout:
                log.write(line)
                log.flush()
                print(line, end='', flush=True)
            code = child.wait()
    if code:
        print('PRIVATE activation failure log preserved: ' + str(file))
        raise subprocess.CalledProcessError(code, command)


def application_readiness(rehearsal, kind):
    """Use the live API's network and its normal private runtime configuration."""
    require(kind in ('game', 'tournaments'), 'Unexpected readiness service')
    # Docker exec does not repeat ENTRYPOINT. Explicitly use the same runtime
    # loader so DB credentials and analysis/Google/Push settings stay private.
    rehearsal.docker('exec', rehearsal.PROJECT + '-' + kind + '-api-1',
                     'python', '/opt/docker/runtime_env.py',
                     'python', '/opt/e2e/rehearsal_app.py', kind, 'integrations')


def preserve_restored_backup(before, session):
    require(before.is_dir() and not before.is_symlink(), 'Unsafe previous activation backup')
    original, plan = read(before / 'session.json'), read(before / 'plan.json')
    require(session['identity']['session_id'] == plan['previous_session']
            == original['identity']['session_id'], 'Previous test environment has not been restored')
    def application_identity(value):
        return {key: item for key, item in value.items()
                if key not in ('harness_sha256', 'runtime_checks_version')}
    require(application_identity(session['identity']) == application_identity(original['identity']),
            'Restored application identity changed')
    require(re.fullmatch(r'[a-f0-9]{32}', plan['new_session']), 'Invalid previous activation plan')
    for name in ARTIFACTS:
        read(before / name) if name.endswith('.json') else require(
            (before / name).is_file() and not (before / name).is_symlink(), 'Incomplete previous backup')
    destination = before.with_name('before-integrations-restored-' + plan['new_session'][:12])
    require(not destination.exists(), 'Previous integration backup already archived')
    before.rename(destination)
    print('Restored activation backup preserved: ' + str(destination))


def failure_inventory(rehearsal, args, state, phase):
    from server_inventory import collect
    try:
        report = {'failed_phase': phase, 'read_only': True, 'inventory': collect(args)}
        # Private child/container logs can contain request credentials; export only
        # state metadata in this report, and retain raw logs as private files.
        file = state / ('activation-failure-' + uuid.uuid4().hex + '.json')
        save(file, report, 0o600)
        print('SANITIZED ACTIVATION FAILURE REPORT (' + phase + '): ' + str(file))
        for service in rehearsal.APPS + rehearsal.WORKERS:
            result = subprocess.run(['sudo', 'docker', 'logs', '--tail', '300', rehearsal.PROJECT + '-' + service + '-1'],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=15)
            if result.returncode == 0:
                file = state / 'activation-logs' / (service + '-' + uuid.uuid4().hex + '.private.log')
                with file.open('x', encoding='utf-8') as stream:
                    file.chmod(0o600)
                    stream.write(result.stdout)
    except Exception:
        print('Some activation diagnostics could not be collected; the original startup log remains preserved.')


def google_client(rehearsal, args):
    if args.google_client_id:
        value = args.google_client_id
    else:
        env = rehearsal.run(['sudo', 'cat', args.project / 'docker/production.env'], capture=True)
        directory = next((line.split('=', 1)[1].strip('"\'') for line in env.splitlines()
                          if line.startswith('CONFIG_DIR=')), None)
        require(directory and Path(directory).is_absolute(), 'Missing captured configuration directory')
        config = json.loads(rehearsal.run(['sudo', 'cat', Path(directory) / 'tournaments.json'], capture=True))
        value = config.get('GOOGLE_CLIENT_ID', '')
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com', value),
            'Google client ID is missing; pass --google-client-id with the public Web client ID')
    return value


def restore(rehearsal, args, state, tools):
    before = state / 'before-integrations'
    original = read(before / 'session.json')
    current = read(state / 'session.json')
    plan = read(before / 'plan.json')
    require(plan['previous_session'] == original['identity']['session_id']
            and current['identity']['session_id'] in (plan['previous_session'], plan['new_session'])
            and original['identity']['images'] == current['identity']['images'], 'Rollback identity changed')
    require_fresh_database_context(original['identity'])
    # Validate every backup before stopping anything.
    for name in ARTIFACTS:
        require((before / name).is_file() and not (before / name).is_symlink(), 'Incomplete integration backup')
    server_action(rehearsal, args, tools, 'stop')
    rehearsal.select_services(current['identity'])
    rehearsal.compose(args, state, 'rm', '-f', *rehearsal.WORKERS, *rehearsal.APPS)
    for name in ARTIFACTS:
        shutil.copyfile(before / name, state / name)
        (state / name).chmod(0o600 if name == 'server-client.json' else 0o644)
    server_action(rehearsal, args, Path(original['tools_dir']), 'start')
    print('Previous browser rehearsal restored; all databases and production services preserved.')


def enable(rehearsal, args, state, tools):
    session = rehearsal.verify_config(args, state)
    if require_integration_context(session['identity']):
        server_action(rehearsal, args, tools, 'check')
        print('All application services are already enabled. Download the current server-client.json.')
        return
    rehearsal.verify_live(session)
    rehearsal.check_listener(session)
    require(read(state / 'server-client.json')['identity'] == session['identity'] == read(state / 'identity.json'),
            'Prepared identity artifacts differ')
    source = next(item for item in session['identity']['sources'] if item['path'] == 'backgammon-tournaments-backend')
    require(source['revision'] == '4cae43076a208c0abe824c0aa227c2b41dd0a31b', 'Expected the audited entry release')
    built_analysis = rehearsal.docker('image', 'inspect', session['identity']['images']['analysis'],
                                      '--format', '{{.Id}}', capture=True)
    require(built_analysis == session['identity']['images']['analysis'], 'Pinned analysis image is missing')
    client_id = google_client(rehearsal, args)
    before = state / 'before-integrations'
    if before.exists():
        require(args.retry_restored, 'An integration backup exists; use --retry-restored only after successful restoration')
        preserve_restored_backup(before, session)
    for name in ARTIFACTS:
        require((state / name).is_file() and not (state / name).is_symlink(), 'Missing integration input')
    before.mkdir(mode=0o700)
    for name in ARTIFACTS:
        shutil.copyfile(state / name, before / name)
        (before / name).chmod(0o600)
    updated, config = candidate(session, read(state / 'compose.e2e.json'), state, tools)
    save(before / 'plan.json', {'previous_session': session['identity']['session_id'],
         'new_session': updated['identity']['session_id']}, 0o600)
    for index in updated['identity']['database_context']['redis_databases'].values():
        require(rehearsal.docker('exec', rehearsal.PROJECT + '-redis-1', 'redis-cli', '-n', str(index),
                'DBSIZE', capture=True) == '0', 'New browser Redis database is already in use; do not flush it')
    # Generate separate test VAPID keys. Capture privately; never print credentials.
    key_code = ('import base64,json; from cryptography.hazmat.primitives.asymmetric import ec; '
                'from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat; '
                'key=ec.generate_private_key(ec.SECP256R1()); '
                'encode=lambda value:base64.urlsafe_b64encode(value).decode().rstrip("="); '
                'print(json.dumps({"WEB_PUSH_PRIVATE_KEY":encode(key.private_numbers().private_value.to_bytes(32,"big")),'
                '"WEB_PUSH_PUBLIC_KEY":encode(key.public_key().public_bytes(Encoding.X962,PublicFormat.UncompressedPoint))}))')
    keys = json.loads(rehearsal.docker('exec', rehearsal.PROJECT + '-tournaments-api-1',
                                     'python', '-c', key_code, capture=True))
    game, tournaments = read(state / 'game.json'), read(state / 'tournaments.json')
    require(game['ANALYSIS_API_TOKEN'] and game['ANALYSIS_API_TOKEN'] == tournaments['ANALYSIS_API_TOKEN'],
            'Browser analysis authentication differs between services')
    token = secrets.token_urlsafe(48)
    analysis = {'SECRET_KEY': secrets.token_urlsafe(48), 'ANALYSIS_API_TOKEN': token,
                'APP_LOG_LEVEL': 'INFO'}
    for values in (game, tournaments):
        values['SECRET_KEY'] = secrets.token_urlsafe(48)
        values['ANALYSIS_API_TOKEN'] = token
        values['ANALYSIS_SERVICE_URL'] = ANALYSIS_URL
        values['AI_SERVICE_URL'] = ANALYSIS_URL
    tournaments.update(keys, WEB_PUSH_SUBJECT=session['identity']['origin'], GOOGLE_CLIENT_ID=client_id)
    ticket, result, command = [secrets.token_urlsafe(48) for _ in range(3)]
    game.update(GAMELINK_TICKET_SECRETS=ticket, GAMELINK_RESULT_SECRET=result, GAMELINK_COMMAND_SECRETS=command)
    tournaments.update(GAMELINK_TICKET_SECRET=ticket, GAMELINK_RESULT_SECRETS=result, GAMELINK_COMMAND_SECRET=command)
    for kind in ('game', 'tournaments', 'analysis'):
        prepare_database(rehearsal, updated['identity'], kind)
    server_action(rehearsal, args, Path(session['tools_dir']), 'stop')
    phase = 'configuration'
    try:
        save(state / 'game.json', game)
        save(state / 'tournaments.json', tournaments)
        save(state / 'analysis.json', analysis)
        save(state / 'compose.e2e.json', config)
        overlay = state / 'compose.integrations.yaml'
        require(not overlay.is_symlink(), 'Unsafe network overlay')
        overlay.write_text(NETWORK_OVERLAY, encoding='utf-8')
        overlay.chmod(0o600)
        save(state / 'session.json', updated)
        save(state / 'identity.json', updated['identity'])
        client = read(state / 'server-client.json')
        client['identity'] = updated['identity']
        client['admin'] = updated['admin']
        save(state / 'server-client.json', client, 0o600)
        public = Path('/var/lib/backgammon-e2e') / updated['identity']['session_id']
        rehearsal.run(['sudo', 'install', '-d', '-m', '0755', public])
        rehearsal.run(['sudo', 'install', '-m', '0644', state / 'engine/engine.js', public / 'engine.js'])
        (state / 'nginx.candidate.conf').write_text(rehearsal.nginx(updated['identity']), encoding='utf-8')
        rehearsal.select_services(updated['identity'])
        rehearsal.verify_config(args, state)
        phase = 'application_start'
        server_action(rehearsal, args, tools, 'start')
        phase = 'application_health'
        server_action(rehearsal, args, tools, 'check')
        phase = 'ai_readiness'
        application_readiness(rehearsal, 'game')
        phase = 'analysis_push_google_readiness'
        application_readiness(rehearsal, 'tournaments')
        phase = 'comprehensive_baseline'
        server_action(rehearsal, args, tools, 'baseline')
    except Exception:
        print('Integration activation failed. Restoring the previous test environment.')
        failure_inventory(rehearsal, args, state, phase)
        restore(rehearsal, args, state, tools)
        raise
    print('ALL APPLICATION SERVICES READY: new game/tournament/analysis databases, isolated Redis, analysis/AI/Push enabled.')
    print('Google configured; authorize the test origin in Google Cloud and verify a real sign-in manually.')
    print('Download ' + str(state / 'server-client.json') + ' and run a NEW 16-player browser scenario.')


def analysis_proof():
    session = read(Path('/opt/e2e/session.json'))
    context = require_integration_context(session['identity'])
    require(context is not None, 'Analysis proof requires explicit integration activation')
    sys.path.insert(0, os.getcwd())
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection, transaction
    from django.db.migrations.executor import MigrationExecutor
    from analysis.models import MatchAnalysis
    database = connection.settings_dict
    require(connection.vendor == 'postgresql' and database['HOST'] == 'postgres'
            and database['NAME'] == context['analysis_database'] and database['USER'] == 'backgammon_analysis'
            and not settings.DEBUG, 'Analysis proof refuses any database outside the disposable context')
    executor = MigrationExecutor(connection)
    require(not executor.migration_plan(executor.loader.graph.leaf_nodes()), 'Pending analysis migrations')
    directory = Path('/data/e2e-audit')
    ai = read(directory / 'readiness-ai.json')
    require(ai.get('passed') is True and ai.get('session_id') == session['identity']['session_id'],
            'Missing live AI endpoint proof')
    summary = read(directory / 'tournament-summary.json')
    require(summary.get('targetSession') == session['identity']['session_id'] and summary['status'] == 'passed',
            'Analysis proof belongs to a different or failed browser run')
    integration = summary.get('integrations', {})
    require(integration.get('analysis', {}).get('completed') == summary['playerCount'] - 1
            and integration.get('push', {}).get('workerHealthy') is True, 'Missing browser integration proof')
    observed = {item['roomId']: item for item in summary['matches']}
    require(len(observed) == summary['playerCount'] - 1, 'Incomplete analysis room coverage')
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION READ ONLY')
        rows = list(MatchAnalysis.objects.filter(source_room_id__in=observed).prefetch_related('players', 'games'))
        require(len(rows) == len(observed) and {str(row.source_room_id) for row in rows} == set(observed),
                'Missing or duplicate room analyses')
        for row in rows:
            match = observed[str(row.source_room_id)]
            require(row.status == 'completed' and row.completed_at and not row.failed_at and not row.error_message
                    and row.engine == 'open_sage' and row.engine_version and row.raw_response,
                    'Analysis did not complete with the real Open Sage engine')
            require(row.tournament_id == summary['tournamentId'] and row.fixture_id == match['fixtureId'],
                    'Analysis source differs from the browser tournament')
            players = list(row.players.all())
            require(len(players) == 2 and {player.color for player in players} == {'white', 'black'} and row.games.exists(),
                    'Analysis results are incomplete')
        report = {'passed': True, 'kind': 'analysis', 'session_id': session['identity']['session_id'],
                  'run_id': summary['runId'], 'database': database['NAME'], 'completed': len(rows),
                  'engines': sorted({row.engine_version for row in rows}),
                  'live_ai': ai,
                  'rooms': sorted(observed), 'push_delivery': 'not tested by the browser tournament'}
        save(directory / (summary['runId'] + '-analysis-audit.json'), report, 0o600)
        print(json.dumps(report, indent=2))


def main():
    if sys.argv[1:] == ['proof']:
        analysis_proof()
        return
    import server_rehearsal as rehearsal
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('enable', 'restore'))
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--rehearsal', required=True, type=Path)
    parser.add_argument('--google-client-id', help='Optional public Web client ID; defaults to the captured server configuration')
    parser.add_argument('--retry-restored', action='store_true', help='Preserve the previous failed-attempt backup after verifying its original session is restored')
    args = parser.parse_args()
    args.project, args.rehearsal = args.project.resolve(), args.rehearsal.resolve()
    rehearsal.configure_target(args)
    state, tools = args.rehearsal / 'browser-e2e-r2', Path(__file__).resolve().parent
    if args.action == 'enable':
        enable(rehearsal, args, state, tools)
    else:
        restore(rehearsal, args, state, tools)


if __name__ == '__main__':
    main()
