"""Attach the existing browser harness to copied candidate data, without image builds."""
import json
import os
from pathlib import Path
import re
import secrets
import time
import uuid

from rehearsal_context import require_browser_database_context
from load_cleanup import validate_plan, save as save_receipt

CONTAINER_CODE = frozenset(('rehearsal_app.py', 'load_cleanup.py', 'rehearsal_context.py',
    'rehearsal_integrations.py', 'rehearsal_entry.py', 'rehearsal_runtime.py',
    'rehearsal_settings.py', 'rehearsal_asgi.py'))

STARTUP_CHECK = '''
import django
django.setup()
from django.core.management import call_command
call_command('migrate', check=True, interactive=False)
import rehearsal_asgi
print('COPIED LOAD STARTUP CHECK PASSED')
'''


def prepare_container_code(server, state, tools):
    """Make only published, read-only mounted Python helpers container-readable."""
    overlay = json.loads((state / 'compose.e2e.json').read_text())
    files = set()
    for service in overlay['services'].values():
        for volume in service.get('volumes', []):
            target = volume.get('target', '')
            if not (target.startswith('/opt/e2e/') and target.endswith('.py')):
                continue
            name = Path(target).name
            source = tools / name
            server.require(name in CONTAINER_CODE and target == '/opt/e2e/' + name
                           and volume.get('type') == 'bind' and volume.get('read_only') is True
                           and volume.get('source') == str(source)
                           and source.is_file() and not source.is_symlink(),
                           'Unsafe container helper mount: ' + target)
            files.add(source)
    server.require(files, 'Missing container helper mounts')
    # These files contain published source code, never session/configuration data.
    # Docker mounts remain read-only and file contents/ownership are unchanged.
    server.run(['sudo', 'chmod', '0644', '--', *sorted(files)])


def preflight_api_startup(server, args, state):
    """Load real observer settings/ASGI before replacing either healthy API."""
    for service in ('game-api', 'tournaments-api'):
        print('COPIED LOAD STARTUP CHECK: ' + service, flush=True)
        server.compose(args, state, 'run', '-T', '--rm', '--no-deps', '--pull', 'never',
                       '--entrypoint', 'python', service,
                       '/opt/docker/runtime_env.py', 'python', '-c', STARTUP_CHECK)


def verify_prepared_tools(server, session):
    tools = Path(session['tools_dir'])
    files, digest = server.harness_inventory(tools, include_documentation=True)
    server.require(files == session['harness_files'] and digest == session['identity']['harness_sha256'],
                   'Prepared load tooling changed; restore the pinned tool commit before proceeding')
    repository = tools.parents[3]
    git = ['git', '-c', 'safe.directory=' + str(repository), '-C', repository]
    server.require(server.run([*git, 'rev-parse', 'HEAD'], capture=True) == session['identity']['tools_revision']
                   and not server.run([*git, 'status', '--porcelain', '--untracked-files=all'], capture=True),
                   'Prepared load tooling no longer uses the clean pinned source')


def prepare(server, args, state, tools):
    target = server.configure_target(args)
    server.require(target is not None, 'Copied load requires a managed release candidate')
    root = args.project.parents[2]
    repository = root / 'sources/backgammon'
    server.require(tools == (repository / 'deploy/workspace/docs/tournament-e2e').resolve(),
                   'Load tooling must use the canonical published server source')
    server.require(re.fullmatch(r'[a-f0-9]{40}', args.tools_revision or ''), 'Pass the approved full --tools-revision')
    git = ['git', '-c', 'safe.directory=' + str(repository), '-C', repository]
    server.require(server.run([*git, 'rev-parse', 'HEAD'], capture=True) == args.tools_revision
                   and not server.run([*git, 'status', '--porcelain', '--untracked-files=all'], capture=True),
                   'Load tooling requires the approved clean source commit')
    server.run(['python3', args.project / 'docker/verify_workspace.py'])
    if state.exists():
        previous = json.loads((state / 'session.json').read_text())
        server.require(previous['identity'].get('validation_id') == target['validation_id']
                       and previous['project_dir'] == str(args.project)
                       and previous['rehearsal_dir'] == str(args.rehearsal), 'Load state belongs to another candidate')
        if (state / 'server-client.json').exists():
            verify_prepared_tools(server, previous)
            server.verify_config(args, state)
            server.verify_live(previous)
            server.check_listener(previous)
            print('COPIED LOAD ALREADY PREPARED; download ' + str(state / 'server-client.json'))
            return
        server.require((state / 'preparation-restored.json').is_file(),
                       'Incomplete load preparation needs restoration before a retry; retained state: ' + str(state))
        state.rename(state.with_name('browser-load-failed-' + uuid.uuid4().hex))
    built = json.loads((args.project / '.built-images.json').read_text())
    server.require(built['image_tag'] == target['image_tag'] and built['sources'] == target['sources'],
                   'Candidate image source identity differs')
    for service in ('postgres', 'redis'):
        value = server.inspect(service)
        server.require(value['project'] == target['project'] and value['service'] == service
                       and value['status'] == 'running' and value['health'] == 'healthy',
                       'Candidate database/cache container differs')
    identity = dict(target, schema_version=1, session_id=uuid.uuid4().hex,
                    load_cleanup_version=1, runtime_checks_version=1,
                    tools_revision=args.tools_revision,
                    images={key: value['id'] for key, value in built['images'].items()},
                    integrations={'analysis': True, 'push': True, 'ai': True, 'google': True})
    # Obtain only selected identity/configuration fields. Never print container environments.
    live = {}
    identity['runtime_files'] = {}
    config_files = None
    context = {'purpose': 'copied-browser-e2e', 'databases': {}, 'markers': {}, 'redis_databases': {}}
    for kind in ('game', 'tournaments', 'analysis'):
        service = kind + '-api'
        value = server.inspect(service)
        server.require(value['project'] == target['project'] and value['service'] == service
                       and value['status'] == 'running' and value['health'] == 'healthy'
                       and value['image'] == identity['images'][kind], 'Wrong candidate API: ' + service)
        raw = json.loads(server.docker('inspect', target['project'] + '-' + service + '-1', '--format',
            '{"env":{{json .Config.Env}},"mounts":{{json .Mounts}},'
            '"files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}}}', capture=True))
        env = dict(item.split('=', 1) for item in raw['env'])
        identity['runtime_files'][kind] = env['RUNTIME_CONFIG_FILE']
        server.require(env['DB_HOST'] == 'postgres' and env['DB_USER'] == 'backgammon_' + kind,
                       'Candidate database host/role differs')
        context['databases'][kind] = env['DB_NAME']
        server.require(re.fullmatch(r'[a-z][a-z0-9_]{0,62}', env['DB_NAME']), 'Unsafe candidate database name')
        catalog = json.loads(server.postgres_query('postgres',
            "SELECT json_build_object('owner',pg_get_userbyid(datdba),'marker',shobj_description(oid,'pg_database')) "
            f"FROM pg_database WHERE datname='{env['DB_NAME']}'"))
        server.require(catalog['owner'] == 'backgammon_' + kind, 'Copied database owner differs')
        context['markers'][kind] = catalog['marker']
        if kind != 'analysis':
            match = re.fullmatch(r'redis://redis:6379/(\d+)', env['REDIS_URL'])
            server.require(match, 'Unexpected candidate Redis URL')
            context['redis_databases'][kind] = int(match[1])
            key = 'GAMELINK_TOURNAMENTS_URL' if kind == 'game' else 'GAMELINK_BACKGAMMON_URL'
            server.require(env[key] == server.ORIGIN, 'Candidate callbacks must already use the test listener')
        files = [Path(name).resolve(strict=True) for name in raw['files'].split(',')]
        server.require(all(file.is_relative_to(args.project) or file.is_relative_to(args.rehearsal)
                           for file in files), 'Compose files are outside this candidate')
        server.require(config_files is None or files == config_files, 'Candidate APIs use different Compose files')
        config_files = files
        live[kind] = env
    identity['database_context'] = context
    require_browser_database_context(identity)
    identity['integration_context'] = {'analysis_database': context['databases']['analysis'],
        'analysis_url': 'http://analysis-api:8000', 'push_key_scope': 'candidate-load'}
    server.select_services(identity)
    for service in server.APPS + server.WORKERS:
        value = server.inspect(service)
        server.require(value['project'] == target['project'] and value['service'] == service
                       and value['image'] == identity['images'][server.SERVICES[service]]
                       and value['status'] == 'running', 'Missing or different candidate service: ' + service)
    server.verify_existing_app_identities({'identity': identity})
    # Verify running workers as well as the three APIs against the same database context.
    for service in server.WORKERS:
        value = server.inspect(service)
        server.require(value['status'] == 'running', 'Candidate worker is not running: ' + service)
        kind = server.SERVICES[service]
        env = dict(item.split('=', 1) for item in json.loads(server.docker('inspect',
            target['project'] + '-' + service + '-1', '--format', '{{json .Config.Env}}', capture=True)))
        server.require(env['DB_HOST'] == 'postgres' and env['DB_NAME'] == context['databases'][kind]
                       and env['DB_USER'] == 'backgammon_' + kind, 'Candidate worker database differs')
    _, identity['network_context'] = server.verify_copied_network(identity)
    server.require(server.CONF.exists(), 'Copied load only attaches to an existing test listener')
    original = server.run(['sudo', 'cat', server.CONF], capture=True)
    previous_upstreams = server.discover_upstreams({'identity': identity})
    server.require(len(re.findall(r'\blisten\s+18443\s+ssl;', original)) == 1
                   and not re.search(r'\blisten\s+(?:443|80)\b', original)
                   and original.count('server {') == 1, 'Unexpected test listener structure')
    # Build only the pure helper, using the existing candidate source. No application image is rebuilt.
    state.mkdir(mode=0o700)
    (state / 'audit').mkdir(mode=0o700)
    server.run(['sudo', 'chgrp', '10001', state / 'audit'])
    (state / 'audit').chmod(0o770)
    server.write(state / 'listener.before.conf', original)
    session = {'identity': identity, 'admin': {'username': 'E2EAdmin_' + identity['session_id'][:12],
               'password': secrets.token_urlsafe(36)}, 'project_dir': str(args.project),
               'rehearsal_dir': str(args.rehearsal), 'tools_dir': str(tools),
               'compose_files': list(map(str, config_files))}
    overrides = {'services': {}}
    for service, kind in server.SERVICES.items():
        overrides['services'][service] = {'image': identity['images'][kind], 'pull_policy': 'never'}
        if kind not in live:
            continue
        env = live[kind]
        # Existing runtime configuration/secrets remain supplied by the pinned base Compose files.
        selected = {key: value for key, value in env.items() if key in
                    ('DB_HOST', 'DB_NAME', 'DB_USER', 'REDIS_URL', 'RUNTIME_CONFIG_FILE',
                     'GAMELINK_TOURNAMENTS_URL', 'GAMELINK_BACKGAMMON_URL', 'ANALYSIS_SERVICE_URL', 'AI_SERVICE_URL')}
        overrides['services'][service].update(environment=selected, volumes=[
                {'type': 'bind', 'source': str(state / 'session.json'), 'target': '/opt/e2e/session.json', 'read_only': True},
                {'type': 'bind', 'source': str(state / 'audit'), 'target': '/data/e2e-audit'},
                *({'type': 'bind', 'source': str(tools / name), 'target': '/opt/e2e/' + name, 'read_only': True}
                  for name in ('rehearsal_app.py', 'load_cleanup.py'))])
    server.write(state / 'session.json', session)
    (state / 'session.json').chmod(0o644)
    server.write(state / 'compose.e2e.json', overrides)
    server.configure_entry_observer(state, tools, identity)
    # Validate effective configuration against live databases before any container changes.
    try:
        server.verify_config(args, state)
        prepare_container_code(server, state, tools)
        preflight_api_startup(server, args, state)
    except BaseException:
        server.write(state / 'preparation-restored.json', {'no_application_services_recreated': True})
        raise
    try:
        server.compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'game-api', 'tournaments-api')
        server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
        for kind in ('game', 'tournaments'):
            server.app(args, state, kind, 'integrations')
        # Helper exporter is intentionally separate from the seven application images.
        builder = 'backgammon-build-' + target['image_tag']
        try:
            server.docker('buildx', 'inspect', builder, '--bootstrap')
            limits = server.docker('inspect', 'buildx_buildkit_' + builder + '0', '--format',
                '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}', capture=True)
            server.require(limits == '3221225472 3221225472 100000 100000', 'Pure helper builder limits differ')
            server.docker('buildx', 'build', '--builder', builder, '--file', tools / 'remote-engine.Dockerfile',
                          '--output', 'type=local,dest=' + str(state / 'engine'), args.project)
        finally:
            server.docker('buildx', 'stop', builder)
        engine = state / 'engine/engine.js'
        server.run(['sudo', 'test', '-f', engine])
        server.run(['sudo', 'test', '!', '-L', engine])
        server.run(['sudo', 'chown', '--no-dereference', f'{os.getuid()}:{os.getgid()}', '--', engine.parent, engine])
        import hashlib
        identity['engine_sha256'] = hashlib.sha256(engine.read_bytes()).hexdigest()
        session['harness_files'], identity['harness_sha256'] = server.harness_inventory(tools, include_documentation=True)
        server.write(state / 'identity.json', identity)
        # Preserve the session inode already bind-mounted by the APIs.
        (state / 'session.json').write_text(json.dumps(session, indent=2) + '\n', encoding='utf-8')
        public = Path('/var/lib/backgammon-e2e') / identity['session_id']
        server.run(['sudo', 'install', '-d', '-m', '0755', public])
        for file in (state / 'identity.json', engine):
            server.run(['sudo', 'install', '-m', '0644', file, public / file.name])
        # Preserve routing; refresh the two recreated API addresses when Docker changes them.
        current_upstreams = server.discover_upstreams(session)
        for service in ('game-api', 'tournaments-api'):
            original = original.replace('http://' + previous_upstreams[service] + '/',
                                        'http://' + current_upstreams[service] + '/')
        # Replace only the two helper locations.
        listener = re.sub(r'\s*location = /(?:__e2e__/identity|backgammon/__e2e__/engine.js)\s*\{[^}]*\}', '', original)
        listener = re.sub(r'^# Session [a-f0-9]{32}[^\n]*\n', '', listener)
        routes = (f'  location = /__e2e__/identity {{ default_type application/json; alias {public}/identity.json; add_header Cache-Control "no-store"; }}\n'
                  f'  location = /backgammon/__e2e__/engine.js {{ default_type application/javascript; alias {public}/engine.js; }}\n')
        listener = '# Session ' + identity['session_id'] + '; copied candidate browser load.\n' + listener.replace('server {', 'server {\n' + routes, 1)
        server.write(state / 'nginx.candidate.conf', listener)
        server.run(['sudo', 'install', '-m', '0644', state / 'nginx.candidate.conf', server.CONF])
        server.run(['sudo', 'nginx', '-t'])
        server.run(['sudo', 'systemctl', 'reload', 'nginx'])
        server.verify_live(session)
        server.check_listener(session)
        server.write(state / 'server-client.json', {'identity': identity, 'admin': session['admin'],
            'harness_files': session['harness_files'], 'load_control': {
                'destination': 'administrator@38.247.146.17', 'project': str(args.project),
                'rehearsal': str(args.rehearsal), 'tools': str(tools)}})
    except BaseException:
        # Remove our overlay from the recreation command; restore the original candidate configuration.
        session['load_overlay_disabled'] = True
        (state / 'session.json').write_text(json.dumps(session, indent=2) + '\n')
        server.compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'game-api', 'tournaments-api')
        server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
        restored = (state / 'listener.before.conf').read_text()
        for service, address in server.discover_upstreams(session).items():
            restored = restored.replace('http://' + previous_upstreams[service] + '/', 'http://' + address + '/')
        server.write(state / 'listener.rollback.conf', restored)
        server.run(['sudo', 'install', '-m', '0644', state / 'listener.rollback.conf', server.CONF])
        server.run(['sudo', 'nginx', '-t'])
        server.run(['sudo', 'systemctl', 'reload', 'nginx'])
        server.write(state / 'preparation-restored.json', {'original_api_configuration_restored': True})
        raise
    print('COPIED LOAD PREPARED; download ' + str(state / 'server-client.json'))


def run_app(server, args, state, kind, action):
    server.compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps',
                   kind + '-migrate', 'python', '/opt/e2e/load_cleanup.py', kind, action)


def read_private(server, file):
    server.require(file.is_file() and not file.is_symlink(), 'Missing or unsafe server receipt')
    return json.loads(server.run(['sudo', 'cat', file], capture=True))


def begin(server, args, state, session):
    verify_prepared_tools(server, session)
    plan = validate_plan(json.loads(args.summary.read_text(encoding='utf-8')), session['identity'])
    lock = state / 'load-run.lock'
    server.write(lock, {'runId': plan['runId'], 'targetSession': plan['targetSession']})
    plan_file = state / 'audit/load-plan.json'
    server.require(not plan_file.is_symlink(), 'Unsafe load plan')
    if plan_file.exists():
        plan_file.write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    else:
        server.write(plan_file, plan)
    (state / 'audit/load-plan.json').chmod(0o644)
    mutations_started = False
    try:
        # begin-load has just verified all these writers are running. Retain that
        # state even if an API crashes during the browser scenario itself.
        server.write(state / ('load-' + plan['runId'] + '-writers.json'), {
            'runId': plan['runId'], 'targetSession': plan['targetSession'],
            'running': ['game-api', 'tournaments-api', 'analysis-api', *server.WORKERS]})
        for kind in ('tournaments', 'game', 'analysis'):
            run_app(server, args, state, kind, 'begin')
        # The session administrator is created after the run baseline and removed by cleanup.
        mutations_started = True
        server.app(args, state, 'tournaments', 'seed')
        for kind in ('game', 'tournaments'):
            server.app(args, state, kind, 'baseline')
    except BaseException:
        if not mutations_started:
            report = {'runId': plan['runId'], 'targetSession': plan['targetSession'], 'passed': False,
                'serverVerification': {'passed': False, 'status': 'skipped'},
                'cleanup': {'passed': True, 'status': 'no_data_created', 'servicesRestored': True}}
            server.write(state / ('load-' + plan['runId'] + '-report.json'), report)
            lock.unlink()
        # Once seed may have run, keep the lock for cleanup/recovery.
        raise


def finish(server, args, state, session, cleanup_only=False):
    verify_prepared_tools(server, session)
    # POSIX advisory locking is released even if SSH/the process is killed.
    import fcntl
    with (state / 'load-operation.lock').open('a') as guard:
        os.chmod(guard.name, 0o600)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finish_locked(server, args, state, session, cleanup_only)


def finish_locked(server, args, state, session, cleanup_only=False):
    lock = json.loads((state / 'load-run.lock').read_text())
    plan = validate_plan(json.loads((state / 'audit/load-plan.json').read_text()), session['identity'])
    server.require(lock == {'runId': plan['runId'], 'targetSession': plan['targetSession']}, 'Load lock differs')
    summary = json.loads(args.summary.read_text(encoding='utf-8')) if args.summary else None
    server.require(cleanup_only or summary and summary.get('runId') == plan['runId']
                   and summary.get('targetSession') == plan['targetSession'], 'Load summary differs')
    report = {'runId': plan['runId'], 'targetSession': plan['targetSession'], 'passed': False,
              'serverVerification': {'passed': False, 'status': 'skipped'}, 'cleanup': {'passed': False, 'status': 'pending'}}
    output = state / ('load-' + plan['runId'] + '-report.json')
    server.require(not output.is_symlink(), 'Unsafe load report')
    if output.exists():
        if cleanup_only:
            previous = json.loads(output.read_text())
            server.require(previous['runId'] == plan['runId'] and previous['targetSession'] == plan['targetSession'], 'Prior load report differs')
            report['serverVerification'] = previous['serverVerification']
    save_receipt(output, report)
    try:
        if not cleanup_only and summary.get('status') == 'passed':
            server.export_entry_report(state, session, summary)
            server.write(state / 'audit/tournament-summary.json', summary) if not (state / 'audit/tournament-summary.json').exists() else (state / 'audit/tournament-summary.json').write_text(json.dumps(summary))
            (state / 'audit/tournament-summary.json').chmod(0o644)
            operations = server.collect_operations(args, state, session, plan['runId'])
            server.run_database_audits(args, state, session, summary, operations)
            report['serverVerification'] = {'passed': True, 'status': 'passed'}
    except Exception as exc:
        report['serverVerification'] = {'passed': False, 'status': 'failed', 'errorType': type(exc).__name__}
    finally:
        running = []
        quiesce_started = False
        phase = 'validate_writers'
        try:
            writers_file = state / ('load-' + plan['runId'] + '-writers.json')
            server.require(not writers_file.is_symlink(), 'Unsafe writer restoration receipt')
            recorded = json.loads(writers_file.read_text()) if writers_file.exists() else None
            if recorded:
                server.require(recorded['runId'] == plan['runId'] and recorded['targetSession'] == plan['targetSession'],
                               'Writer restoration receipt differs')
            # Quiesce only this candidate. Prevent late callbacks/analyses recreating removed data.
            for service in ('game-api', 'tournaments-api', 'analysis-api', *server.WORKERS):
                value = server.inspect(service)
                server.require(value['project'] == server.PROJECT and value['service'] == service
                               and value['image'] == session['identity']['images'][server.SERVICES[service]], 'Cleanup service identity differs')
                server.require(value['status'] in ('running', 'exited'), 'Unexpected writer state')
                if value['status'] == 'running' or recorded and service in recorded['running']:
                    running.append(service)
            if recorded is None:
                server.write(writers_file, {'runId': plan['runId'], 'targetSession': plan['targetSession'], 'running': running})
            if running:
                phase = 'stop_writers'
                quiesce_started = True
                server.docker('stop', '--time', '45', *(server.PROJECT + '-' + service + '-1' for service in running))
                for service in running:
                    server.require(server.inspect(service)['status'] == 'exited', 'Candidate writer did not stop: ' + service)
            # Complete all three scope checks before the first delete. Persist them for retries.
            for kind in ('tournaments', 'game', 'analysis'):
                phase = 'discover_' + kind
                run_app(server, args, state, kind, 'discover')
            tournament_scope = read_private(server, state / 'audit' / ('load-' + plan['runId'] + '-tournaments-scope.json'))
            retired_file = state / 'audit/load-retired-identities.json'
            retired = read_private(server, retired_file) if retired_file.exists() else []
            retired.extend({'issuer': tournament_scope['issuer'], 'externalId': value} for value in tournament_scope['externalIds'])
            # Receipts are retained; the application/database rows are removed.
            save_receipt(retired_file, retired)
            retired_file.chmod(0o644)
            callbacks_file = state / 'audit/load-retired-runs.json'
            callbacks = read_private(server, callbacks_file) if callbacks_file.exists() else []
            callbacks.append({'tournamentId': tournament_scope['tournamentId'], 'fixtureIds': tournament_scope['fixtureIds']})
            save_receipt(callbacks_file, callbacks)
            callbacks_file.chmod(0o644)
            for kind in ('analysis', 'game', 'tournaments'):
                phase = 'cleanup_' + kind
                run_app(server, args, state, kind, 'cleanup')
            for kind in ('analysis', 'game', 'tournaments'):
                phase = 'verify_' + kind
                run_app(server, args, state, kind, 'verify')
            report['cleanup'] = {'passed': True, 'status': 'passed', 'servicesRestored': False,
                'receipts': {kind: read_private(server, state / 'audit' / ('load-' + plan['runId'] + '-' + kind + '-cleanup.json'))
                             for kind in ('game', 'tournaments', 'analysis')}}
        except Exception as exc:
            report['cleanup'].update(passed=False, status='failed', phase=phase, errorType=type(exc).__name__)
            if isinstance(exc, ValueError):
                report['cleanup']['reason'] = str(exc)
        finally:
            try:
                if quiesce_started and running:
                    server.docker('start', *(server.PROJECT + '-' + service + '-1' for service in running))
                    server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
                    server.verify_live(session)
                    server.check_listener(session)
                report['cleanup']['servicesRestored'] = True
            except Exception as exc:
                report['cleanup'].update(passed=False, status='restore_failed', restoreErrorType=type(exc).__name__)
            receipts = report['cleanup'].setdefault('receipts', {})
            for kind in ('game', 'tournaments', 'analysis'):
                file = state / 'audit' / ('load-' + plan['runId'] + '-' + kind + '-cleanup.json')
                if file.exists():
                    try:
                        value = read_private(server, file)
                        server.require(value.get('runId') == plan['runId'] and value.get('targetSession') == plan['targetSession']
                                       and value.get('kind') == kind, 'Cleanup receipt identity differs')
                        receipts[kind] = value
                    except Exception as exc:
                        report['cleanup'].update(passed=False, status='receipt_failed', receiptErrorType=type(exc).__name__)
            report['passed'] = report['serverVerification']['passed'] and report['cleanup']['passed']
            save_receipt(output, report)
            if report['cleanup']['passed']:
                (state / 'load-run.lock').unlink()
    print('COPIED LOAD REPORT: ' + str(output))
    server.require(report['cleanup']['passed'], 'Cleanup incomplete; retry cleanup-load for this run')
    if not cleanup_only:
        server.require(report['serverVerification']['passed'], 'Server verification failed or browser scenario was incomplete; cleanup was attempted')
