"""Prepare/start a test listener in existing host Nginx. Never cut over production."""
import argparse
import copy
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import uuid

from rehearsal_context import fresh_database_context, require_fresh_database_context, require_browser_database_context, rehearsal_project
from rehearsal_integrations import require_integration_context, verify_integration_config

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
BASE_SERVICES, BASE_APPS, BASE_WORKERS = SERVICES.copy(), APPS.copy(), WORKERS.copy()
UPSTREAM_PORTS = {'game-api': 8000, 'tournaments-api': 8000,
                  'game-frontend': 80, 'tournaments-frontend': 80, 'admin-frontend': 80}
CONF = Path('/etc/nginx/conf.d/backgammon-rehearsal-e2e.conf')
MANAGED_ROOT = Path('/home/dev/backgammon-project')


def copied_target_from_plan(args):
    """Read the running candidate's immutable plan without an old E2E marker."""
    root = MANAGED_ROOT
    require(args.project.parent == root / 'deploy/backgammon-deploy'
            and re.fullmatch(r'backgammon-[a-z0-9-]{1,64}', args.project.name),
            'Copied candidate project is outside the managed layout')
    plan_file = root / 'reports/release-validation' / args.project.name / 'plan.json'
    require(plan_file.is_file() and not plan_file.is_symlink(), 'Missing or unsafe copied candidate plan')
    plan = json.loads(plan_file.read_text())
    require(re.fullmatch(r'[a-f0-9]{32}', plan.get('validation_id', ''))
            and re.fullmatch(r'[a-f0-9]{40}', plan.get('infrastructure_revision', ''))
            and plan['release']['image_tag'] == args.project.name,
            'Copied candidate plan identity differs')
    require(args.rehearsal == root / 'backups/backgammon-backups' /
            ('validation-' + plan['validation_id']) / 'docker-rehearsal',
            'Copied candidate rehearsal differs from its plan')
    for name in ('.workspace-release.json', '.built-images.json'):
        file = args.project / name
        require(file.is_file() and not file.is_symlink(), 'Missing or unsafe candidate artifact: ' + name)
        artifact = json.loads(file.read_text())
        require(artifact['image_tag'] == plan['release']['image_tag']
                and artifact['infrastructure_revision'] == plan['infrastructure_revision']
                and artifact['sources'] == plan['release']['sources'],
                'Copied candidate artifact differs from its plan: ' + name)
    return {'validation_id': plan['validation_id'],
            'project': 'backgammon-candidate-' + plan['validation_id'], 'origin': ORIGIN,
            'image_tag': plan['release']['image_tag'],
            'infrastructure_revision': plan['infrastructure_revision'],
            'sources': plan['release']['sources'], 'project_dir': str(args.project)}


def configure_target(args):
    """Select the historical rehearsal or a sealed stage-1--4 candidate."""
    global PROJECT, TAG
    target_file = args.rehearsal / 'validation-target.json'
    require(not target_file.is_symlink(), 'Unsafe validation target')
    if not target_file.exists():
        if getattr(args, 'copied_load', False):
            target = copied_target_from_plan(args)
        else:
            require(args.project.name == 'bg-20261005-git-r2'
                    and args.rehearsal.name == 'docker-rehearsal'
                    and args.rehearsal.parent.name == 'rehearsal-20261005T184922Z',
                    'Unexpected release or rehearsal directory')
            PROJECT, TAG = 'backgammon-rehearsal-20261005t184922z', 'bg-20261005-git-r2'
            return None
    else:
        target = json.loads(target_file.read_text())
    project = rehearsal_project(target)
    root = args.project.parents[2]
    require(root == MANAGED_ROOT
            and args.project.parent == root / 'deploy/backgammon-deploy'
            and args.project.name == target['image_tag']
            and args.rehearsal == root / 'backups/backgammon-backups' /
                ('validation-' + target['validation_id']) / 'docker-rehearsal'
            and args.project.samefile(target['project_dir']), 'Candidate paths differ from the managed layout')
    release = json.loads((args.project / '.workspace-release.json').read_text())
    require(release['image_tag'] == target['image_tag']
            and release['infrastructure_revision'] == target['infrastructure_revision']
            and release['sources'] == target['sources'], 'Candidate source identity changed')
    PROJECT, TAG = project, target['image_tag']
    return target


def select_services(identity):
    SERVICES.clear()
    SERVICES.update(BASE_SERVICES)
    APPS[:] = BASE_APPS
    WORKERS[:] = BASE_WORKERS
    if require_integration_context(identity):
        SERVICES.update({'analysis-api': 'analysis', 'analysis-worker': 'analysis',
                         'analysis-migrate': 'analysis', 'push-worker': 'tournaments'})
        APPS.append('analysis-api')
        WORKERS.extend(['analysis-worker', 'push-worker'])


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
        stream.flush()
        os.fsync(stream.fileno())
    file.chmod(0o600 if private else 0o644)


def inspect(service):
    # Select only identity/state fields. Never dump a container environment.
    return json.loads(docker('inspect', f'{PROJECT}-{service}-1', '--format',
        '{"image":{{json .Image}},"status":{{json .State.Status}},'
        '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}""{{end}},'
        '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
        '"service":{{json (index .Config.Labels "com.docker.compose.service")}}}', capture=True))


def harness_inventory(tools, include_documentation=False):
    files = sorted(file.name for file in tools.iterdir() if file.is_file()
                   and (file.suffix in ('.mjs', '.py', '.ps1', '.Dockerfile')
                        or include_documentation and file.name == 'INTEGRATIONS.he.md'))
    digest = hashlib.sha256()
    for name in files:
        digest.update((name + '\0').encode())
        digest.update((tools / name).read_bytes())
    return files, digest.hexdigest()


def same_directory(recorded, selected):
    """Accept a compatibility link only when it names the same existing directory."""
    try:
        recorded, selected = Path(recorded), Path(selected)
        return recorded.is_dir() and selected.is_dir() and recorded.samefile(selected)
    except (OSError, TypeError, ValueError):
        return False


def installed_tools_path(recorded, state, source):
    state = Path(state).resolve(strict=True)
    active = Path(recorded).resolve(strict=True)
    backup_root = state.parents[2]
    require(backup_root.name == 'backgammon-backups', 'Unexpected rehearsal backup root')
    if backup_root.parent.name == 'backups':
        project_root = backup_root.parent.parent
        require(project_root.name == 'backgammon-project', 'Unexpected managed project root')
        expected_parent = project_root / 'tools'
    else:
        expected_parent = backup_root.parent
    require(active.is_dir() and active.parent == expected_parent.resolve(strict=True)
            and active.name.startswith('backgammon-e2e-tools-') and active != Path(source).resolve(strict=True),
            'Unexpected active tool installation')
    return active


def refresh_tools(args, state, tools, session):
    """Deploy reviewed audit/runner changes from Git into the existing tool mounts."""
    revision = args.tools_revision
    require(re.fullmatch(r'[a-f0-9]{40}', revision or ''), 'Pass the approved full --tools-revision')
    repository = tools.parents[3]
    git = lambda *command: run(['git', '-C', repository, *command], capture=True)
    require(git('rev-parse', 'HEAD') == revision and not git('status', '--porcelain', '--untracked-files=all'),
            'Tool source must be the clean approved Git commit')
    names, digest = harness_inventory(tools)
    tracked = {Path(name).name for name in git('ls-files', '--', 'deploy/workspace/docs/tournament-e2e').splitlines()}
    require(set(names) <= tracked and all(not (tools / name).is_symlink() for name in names),
            'Tool source contains untracked or unsafe files')
    active = installed_tools_path(session['tools_dir'], state, tools)
    require(harness_inventory(active) == (session['harness_files'], session['identity']['harness_sha256'])
            and names == session['harness_files'], 'Installed tool inventory differs from the prepared session')
    verify_live(session)
    check_listener(session)
    if digest == session['identity']['harness_sha256']:
        print('TOOLS ALREADY CURRENT: ' + revision)
        return
    allowed = {'rehearsal_app.py', 'rehearsal_audit_test.py', 'server_rehearsal.py', 'rehearsal_observer_config_test.py',
               'run-remote-e2e.mjs', 'run-remote-tournament-e2e.ps1',
               'source-versions.mjs', 'source-versions_test.mjs'}
    changed = {name for name in names if (tools / name).read_bytes() != (active / name).read_bytes()}
    require(changed <= allowed, 'Running-session update includes changes requiring a separate deployment: '
            + ', '.join(sorted(changed - allowed)))
    files = {name: state / name for name in ('session.json', 'identity.json', 'server-client.json')}
    require(all(file.is_file() and not file.is_symlink() for file in files.values()), 'Unsafe identity artifact')
    client = json.loads(files['server-client.json'].read_text())
    require(session['identity'] == client['identity'] == json.loads(files['identity.json'].read_text())
            and client['admin'] == session['admin'] and client['harness_files'] == names,
            'Prepared identity artifacts do not agree')
    baselines = [state / 'audit' / name for name in
                 ('baseline-game.json', 'baseline-tournaments.json', 'operations-baseline.json')]
    require(all(file.is_file() and not file.is_symlink() for file in baselines), 'Missing existing baseline')
    baseline_hashes = run(['sudo', 'sha256sum', *baselines], capture=True)
    updated = copy.deepcopy(session)
    updated['identity']['harness_sha256'] = digest
    updated_client = copy.deepcopy(client)
    updated_client['identity'] = updated['identity']
    encode = lambda value: (json.dumps(value, indent=2) + '\n').encode()
    replacements = {active / name: (tools / name).read_bytes() for name in changed}
    replacements.update({files['session.json']: encode(updated), files['identity.json']: encode(updated['identity']),
                         files['server-client.json']: encode(updated_client)})
    replacements[active / 'SHA256SUMS'] = ('\n'.join(hashlib.sha256((tools / name).read_bytes()).hexdigest()
                                        + '  ' + name for name in names) + '\n').encode()
    replacements[active / 'bundle-info.json'] = encode({'harness_sha256': digest, 'tool_count': len(names),
        'source_revision': revision, 'source_directory': str(tools), 'application_images_rebuilt': False,
        'runtime_settings_included': False})
    require(all(file.is_file() and not file.is_symlink() for file in replacements), 'Unsafe update destination')
    originals = {file: (file.read_bytes(), file.stat().st_mode & 0o777) for file in replacements}
    backup = state / 'tool-updates' / revision
    backup.parent.mkdir(exist_ok=True, mode=0o700)
    require(not backup.parent.is_symlink(), 'Unsafe tool backup directory')
    backup_index = [{'path': str(file), 'mode': mode} for file, (data, mode) in originals.items()]
    if backup.exists():
        require(not backup.is_symlink() and (backup / 'files.json').is_file()
                and not (backup / 'files.json').is_symlink()
                and json.loads((backup / 'files.json').read_text()) == backup_index,
                'Existing update backup belongs to another operation')
        for index, (file, (data, mode)) in enumerate(originals.items()):
            saved = backup / (str(index) + '-' + file.name)
            require(saved.is_file() and not saved.is_symlink() and saved.read_bytes() == data,
                    'Existing update backup differs from the restored installation')
    else:
        backup.mkdir(mode=0o700)
        for index, (file, (data, mode)) in enumerate(originals.items()):
            write(backup / (str(index) + '-' + file.name), data.decode('utf-8'))
        write(backup / 'files.json', backup_index)
    public = Path('/var/lib/backgammon-e2e') / session['identity']['session_id'] / 'identity.json'
    require(public.is_file() and not public.is_symlink()
            and json.loads(public.read_text()) == session['identity'], 'Public test identity differs from the session')
    try:
        for file, data in replacements.items():
            # Existing bind mounts must keep their inodes; running APIs are not reloaded.
            file.write_bytes(data)
            file.chmod(originals[file][1])
        require(harness_inventory(active) == (names, digest), 'Updated tool bytes do not match Git')
        run(['sudo', 'install', '-m', '0644', files['identity.json'], public])
        verify_live(updated)
        check_listener(updated)
        require(run(['sudo', 'sha256sum', *baselines], capture=True) == baseline_hashes,
                'Existing baseline changed during the update')
    except Exception:
        for file, (data, mode) in originals.items():
            file.write_bytes(data)
            file.chmod(mode)
        run(['sudo', 'install', '-m', '0644', files['identity.json'], public])
        raise
    print('TOOLS UPDATED FROM GIT: ' + revision)
    print('PRIVATE UPDATE BACKUP: ' + str(backup))
    print('Existing session, containers, databases and baselines preserved. Audit the SAME completed run.')


def configure_entry_observer(state, tools, identity):
    """Only the fresh browser APIs receive the passive observer; images stay pinned."""
    require_browser_database_context(identity)
    file = state / 'compose.e2e.json'
    overrides = json.loads(file.read_text())
    for service, values in overrides['services'].items():
        if SERVICES.get(service) not in ('game', 'tournaments', 'analysis'):
            continue
        volumes = values.setdefault('volumes', [])
        for volume in volumes:
            target = volume.get('target', '')
            if target.startswith('/opt/e2e/') and target.endswith('.py'):
                source = tools / Path(target).name
                require(source.is_file() and not source.is_symlink(), 'Missing rehearsal helper')
                volume['source'] = str(source)
        # Runtime snapshots also run in migrate containers for baseline/audit,
        # and reuse session/validation helpers from rehearsal_entry.
        for name in ('rehearsal_context.py', 'rehearsal_integrations.py', 'rehearsal_entry.py', 'rehearsal_runtime.py'):
            target = '/opt/e2e/' + name
            volumes[:] = [volume for volume in volumes if volume.get('target') != target]
            volumes.append({'type': 'bind', 'source': str(tools / name), 'target': target, 'read_only': True})
    for kind in ('game', 'tournaments'):
        values = overrides['services'][kind + '-api']
        values.setdefault('environment', {}).update(
            DJANGO_SETTINGS_MODULE='rehearsal_settings', E2E_ADMISSION_KIND=kind, PYTHONPATH='/opt/e2e')
        volumes = values.setdefault('volumes', [])
        for name in ('rehearsal_entry.py', 'rehearsal_settings.py', 'rehearsal_asgi.py', 'rehearsal_context.py'):
            source = tools / name
            require(source.is_file() and not source.is_symlink(), 'Missing or unsafe entry observer')
            target = '/opt/e2e/' + name
            volumes[:] = [volume for volume in volumes if volume.get('target') != target]
            volumes.append({'type': 'bind', 'source': str(source), 'target': target, 'read_only': True})
        values['command'] = ['sh', '-c', 'python manage.py migrate --check && exec daphne '
                             '-b 0.0.0.0 -p 8000 --access-log - rehearsal_asgi:application']
    file.write_text(json.dumps(overrides, indent=2) + '\n', encoding='utf-8')


def export_entry_report(state, session, summary):
    from entry_flow_report import build_report, parse_events
    fresh = require_browser_database_context(session['identity'])
    require(type(summary.get('tournamentId')) is int and summary['tournamentId'] > 0,
            'Entry report requires a created tournament')
    events = []
    for kind in ('game', 'tournaments'):
        # Python console logging goes to stderr; keep both streams private.
        output = subprocess.run(['sudo', 'docker', 'logs', '--tail', '100000', f'{PROJECT}-{kind}-api-1'],
                                check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        events.extend(parse_events(output.stdout, session['identity']['session_id'], kind))
    # Activation may have run in the normal worker, which is not instrumented.
    # One read after the run preserves its authoritative write-once timestamp.
    availability = json.loads(postgres_query(fresh['databases']['tournaments'],
        "SELECT COALESCE(json_agg(json_build_object('fixtureId', f.id, 'playableAt', "
        "to_char(f.playable_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))), '[]'::json) "
        "FROM tournaments_fixture f JOIN tournaments_mode m ON m.id = f.mode_id "
        f"WHERE m.tournament_id = {summary['tournamentId']}"))
    report = build_report(summary, events, availability)
    file = state / 'audit' / ('entry-flow-' + summary['runId'] + '.json')
    require(not file.is_symlink(), 'Entry report cannot be a symlink')
    file.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    file.chmod(0o600)
    print('Entry phase report: ' + str(file))
    print(json.dumps({'coverage': report['coverage'], 'serverMetrics': report['serverMetrics']}, indent=2))


def refresh_prepared_harness(state, tools, session, context_change=False):
    # A reviewed tool fix can resume this same stopped session without rebuilding images.
    require(not CONF.exists(), 'Do not update a harness while its test listener is installed')
    client_file = state / 'server-client.json'
    identity_file = state / 'identity.json'
    for file in (client_file, identity_file, state / 'session.json'):
        require(file.is_file() and not file.is_symlink(), 'Missing or unsafe prepared artifact')
    client = json.loads(client_file.read_text())
    def core(identity):
        ignored = ('harness_sha256', 'database_context') if context_change else ('harness_sha256',)
        return {key: value for key, value in identity.items() if key not in ignored}
    require(core(client['identity']) == core(session['identity'])
            and core(json.loads(identity_file.read_text())) == core(session['identity'])
            and client['admin'] == session['admin'], 'Prepared artifacts belong to a different session')
    engine = state / 'engine/engine.js'
    require(engine.is_file() and not engine.is_symlink()
            and hashlib.sha256(engine.read_bytes()).hexdigest() == session['identity']['engine_sha256'],
            'Prepared engine differs from the pinned build')
    configure_entry_observer(state, tools, session['identity'])
    session['identity']['runtime_checks_version'] = 1
    session['harness_files'], session['identity']['harness_sha256'] = harness_inventory(tools)
    (state / 'session.json').write_text(json.dumps(session, indent=2) + '\n', encoding='utf-8')
    identity_file.write_text(json.dumps(session['identity'], indent=2) + '\n', encoding='utf-8')
    client_file.write_text(json.dumps({'identity': session['identity'], 'admin': session['admin'],
                                      'harness_files': session['harness_files']}, indent=2) + '\n', encoding='utf-8')
    client_file.chmod(0o600)
    public = Path('/var/lib/backgammon-e2e') / session['identity']['session_id']
    run(['sudo', 'install', '-m', '0644', identity_file, public / 'identity.json'])
    print('Prepared harness identity refreshed; download server-client.json again before a browser run.')


def verify_existing_app_identities(session, stopped=False):
    for service in APPS + WORKERS:
        exists = docker('ps', '-aq', '--filter', f'label=com.docker.compose.project={PROJECT}',
                        '--filter', f'label=com.docker.compose.service={service}', capture=True)
        if exists:
            value = inspect(service)
            require(value['project'] == PROJECT and value['service'] == service
                    and value['image'] == session['identity']['images'][SERVICES[service]],
                    'Existing rehearsal container belongs to a different release')
            if stopped:
                require(value['status'] in ('created', 'exited'), 'Stop rehearsal applications before fresh-databases')


def postgres_query(database, sql):
    return docker('exec', '--user', 'postgres', PROJECT + '-postgres-1', 'psql', '-X', '-At',
                  '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql, capture=True)


def fresh_databases(args, state, tools, session):
    require(require_integration_context(session['identity']) is None, 'Integration databases are provisioned by rehearsal_integrations')
    require(not CONF.exists(), 'Stop the test listener before fresh-databases')
    verify_existing_app_identities(session, stopped=True)
    for service in ('postgres', 'redis'):
        value = inspect(service)
        require(value['project'] == PROJECT and value['service'] == service
                and value['status'] == 'running' and value['health'] == 'healthy',
                'Existing rehearsal infrastructure is not healthy')
    context = fresh_database_context(session['identity']['session_id'])
    plan = {'session_id': session['identity']['session_id'], 'database_context': context}
    plan_file = state / 'fresh-databases.json'

    def catalog(name):
        result = postgres_query('postgres',
            "SELECT json_build_object('owner', pg_get_userbyid(datdba), "
            "'marker', shobj_description(oid, 'pg_database')) "
            f"FROM pg_database WHERE datname = '{name}'")
        return json.loads(result) if result else None

    for kind in ('game', 'tournaments'):
        role = 'backgammon_' + kind
        result = postgres_query('postgres', "SELECT json_build_object('login', rolcanlogin, "
            "'superuser', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole) "
            f"FROM pg_roles WHERE rolname = '{role}'")
        require(result and json.loads(result) == {'login': True, 'superuser': False,
                                                  'createdb': False, 'createrole': False},
                'Expected existing unprivileged rehearsal database roles')
    if plan_file.exists():
        require(not plan_file.is_symlink() and json.loads(plan_file.read_text()) == plan,
                'Fresh database plan belongs to another session')
        require(all(file.is_file() and not file.is_symlink() for file in (
            state / 'session.before-fresh.json', state / 'compose.e2e.before-fresh.json')),
            'Fresh database plan is missing its original configuration backups')
    else:
        for name in context['databases'].values():
            require(catalog(name) is None, 'Refusing to adopt an existing unmarked test database')
        for index in context['redis_databases'].values():
            require(docker('exec', PROJECT + '-redis-1', 'redis-cli', '-n', str(index), 'DBSIZE',
                           capture=True) == '0', 'Selected browser Redis database is already in use')
        backups = {state / 'session.before-fresh.json': session,
                   state / 'compose.e2e.before-fresh.json': json.loads((state / 'compose.e2e.json').read_text())}
        for file, original in backups.items():
            if file.exists():
                require(file.is_file() and not file.is_symlink() and json.loads(file.read_text()) == original,
                        'An interrupted preparation has different configuration backups')
            else:
                write(file, original)
        # Record the two reserved names before creating either database, for interrupted retries.
        write(plan_file, plan)
    for kind, name in context['databases'].items():
        role = 'backgammon_' + kind
        marker = f'backgammon-browser-e2e:{plan["session_id"]}:{kind}'
        existing = catalog(name)
        if existing is None:
            postgres_query('postgres', f'CREATE DATABASE "{name}" OWNER "{role}" TEMPLATE template0')
            existing = catalog(name)
        require(existing['owner'] == role and existing['marker'] in (None, marker),
                'Test database ownership or session marker changed')
        if existing['marker'] is None:
            require(postgres_query(name, "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'") == '0',
                'An unmarked database contains tables; refusing to adopt it')
            postgres_query('postgres', f"COMMENT ON DATABASE \"{name}\" IS '{marker}'")
        postgres_query('postgres', f'REVOKE ALL ON DATABASE "{name}" FROM PUBLIC')
    overrides = json.loads((state / 'compose.e2e.json').read_text())
    for service, values in overrides['services'].items():
        if service.startswith(('game-', 'tournaments-')) and service not in ('game-frontend', 'tournaments-frontend'):
            kind = 'game' if service.startswith('game-') else 'tournaments'
            values['environment'].update(DB_NAME=context['databases'][kind],
                REDIS_URL=f'redis://redis:6379/{context["redis_databases"][kind]}')
            module = {'type': 'bind', 'source': str(tools / 'rehearsal_context.py'),
                      'target': '/opt/e2e/rehearsal_context.py', 'read_only': True}
            if module not in values['volumes']:
                values['volumes'].append(module)
    (state / 'compose.e2e.json').write_text(json.dumps(overrides, indent=2) + '\n', encoding='utf-8')
    session['identity']['database_context'] = context
    refresh_prepared_harness(state, tools, session, context_change=True)
    verify_config(args, state)
    # Remove only stopped app containers so their replacement reads the new DB_NAME/REDIS_URL.
    # No volume is removed, and PostgreSQL/Redis are not included in this command.
    compose(args, state, 'rm', '-f', *WORKERS, *APPS)
    print(json.dumps(context, indent=2))
    print('Fresh browser database context prepared. Copied databases, snapshots and existing infrastructure preserved.')


def prepare(args, state, tools):
    require(not state.exists(), 'Test state already exists; use start/check with this same session, not prepare again')
    run(['python3', args.project / 'docker/verify_workspace.py'])
    built = json.loads((args.project / '.built-images.json').read_text())
    require(built['image_tag'] == TAG and len(built['sources']) == 4, 'Expected the pinned release images')
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
    target = configure_target(args)
    if target is not None:
        identity.update(validation_id=target['validation_id'],
                        infrastructure_revision=target['infrastructure_revision'])
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
        require(limits == '3221225472 3221225472 100000 100000', 'Engine builder resource limits differ from the reviewed limits')
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


def upstreams_for_addresses(addresses, subnets):
    require(set(addresses) == set(UPSTREAM_PORTS), 'Incomplete rehearsal upstream addresses')
    networks = [ipaddress.ip_network(value) for value in subnets]
    require(networks and len(set(addresses.values())) == len(addresses), 'Unexpected rehearsal network addresses')
    upstreams = {}
    for service, address in addresses.items():
        ip = ipaddress.IPv4Address(address)
        require(not (ip.is_loopback or ip.is_unspecified or ip.is_multicast or ip.is_link_local)
                and any(ip in network for network in networks if network.version == 4),
                'Upstream address is outside the rehearsal bridge: ' + service)
        upstreams[service] = f'{ip}:{UPSTREAM_PORTS[service]}'
    return upstreams


def discover_upstreams(session):
    name = PROJECT + '_application'
    network = json.loads(docker('network', 'inspect', name, capture=True))[0]
    require(network['Name'] == name and network['Driver'] == 'bridge' and network['Internal'] is True,
            'Expected the existing internal rehearsal bridge')
    subnets = [item['Subnet'] for item in network['IPAM']['Config'] if item.get('Subnet')]
    addresses = {}
    for service in UPSTREAM_PORTS:
        value = inspect(service)
        require(value['project'] == PROJECT and value['service'] == service
                and value['image'] == session['identity']['images'][SERVICES[service]]
                and value['status'] == 'running' and value['health'] == 'healthy',
                'Upstream is not the healthy pinned rehearsal container: ' + service)
        attached = json.loads(docker('inspect', PROJECT + '-' + service + '-1', '--format',
                                     '{{json .NetworkSettings.Networks}}', capture=True))
        expected_networks = {name}
        if require_integration_context(session['identity']) and service == 'tournaments-api':
            expected_networks.add(PROJECT + '_integrations_egress')
        require(set(attached) == expected_networks and attached[name]['NetworkID'] == network['Id'],
                'Upstream network changed: ' + service)
        addresses[service] = attached[name]['IPAddress']
    return upstreams_for_addresses(addresses, subnets)


def nginx(identity, upstreams=None):
    require(re.fullmatch(r'[a-f0-9]{32}', identity['session_id']), 'Invalid Nginx session identifier')
    public = Path('/var/lib/backgammon-e2e') / identity['session_id']
    if upstreams is not None:
        require(set(upstreams) == set(UPSTREAM_PORTS), 'Incomplete Nginx upstreams')
        for service, destination in upstreams.items():
            address, separator, port = destination.rpartition(':')
            require(separator and port == str(UPSTREAM_PORTS[service])
                    and str(ipaddress.IPv4Address(address)) == address,
                    'Invalid Nginx upstream: ' + service)
    def proxy(prefix, service, target=None, websocket=False):
        return f'''location {prefix} {{
    proxy_pass http://{upstreams[service]}{target or ''};
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    {'proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";' if websocket else ''}
}}'''
    # Before applications start this is only an identity/engine preview, with no proxy routes.
    routes = [] if upstreams is None else [
        proxy('/backgammon/api/', 'game-api', '/api/'), proxy('/backgammon/ws/', 'game-api', '/ws/', True),
        proxy('/api/link/', 'game-api', '/api/link/'), proxy('/api/gamelink/', 'tournaments-api', '/api/gamelink/'),
        proxy('/tournaments-api/', 'tournaments-api', '/api/'), proxy('/tournaments-ws/', 'tournaments-api', '/ws/', True),
        proxy('/tournaments-play/', 'tournaments-api', '/t/'), proxy('/api/admin/', 'tournaments-api', '/api/admin/'),
        proxy('/tournaments-accounts/', 'tournaments-api', '/accounts/'),
        proxy('/tournaments-django-admin/', 'tournaments-api', '/admin/'),
        proxy('/backgammon/', 'game-frontend'), proxy('/tournaments/', 'tournaments-frontend'),
        proxy('/tournaments-admin/', 'admin-frontend'), proxy('/tournaments-static/', 'tournaments-frontend'),
        proxy('/tournaments-media/', 'tournaments-frontend')]
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


def refresh_nginx_candidate(state, session):
    candidate = state / 'nginx.candidate.conf'
    require(candidate.is_file() and not candidate.is_symlink()
            and 'Session ' + session['identity']['session_id'] in candidate.read_text(),
            'Nginx candidate belongs to another session')
    backup = state / 'nginx.before-container-routing.conf'
    if not backup.exists():
        write(backup, candidate.read_text())
    else:
        require(backup.is_file() and not backup.is_symlink(), 'Unsafe Nginx backup')
    candidate.write_text(nginx(session['identity'], discover_upstreams(session)), encoding='utf-8')
    print('Test Nginx upstreams refreshed from healthy container addresses on the internal bridge.')


def compose(args, state, *command, capture=False):
    environment = dict(os.environ, TRANSFER_DIR=str(args.rehearsal / 'transfer-v2'),
                       PUBLIC_HOST=HOST, PUBLIC_ORIGIN=ORIGIN)
    extra = []
    session = json.loads((state / 'session.json').read_text())
    identity = session['identity']
    copied = identity.get('load_cleanup_version') == 1
    if require_integration_context(identity) and not copied:
        overlay = state / 'compose.integrations.yaml'
        require(overlay.is_file() and not overlay.is_symlink(), 'Missing integration network overlay')
        extra = ['-f', overlay]
    files = session['compose_files'] if copied else [args.project / 'docker/compose.production.yaml',
                                                    args.rehearsal / 'compose.override.yaml']
    if not session.get('load_overlay_disabled'):
        files = [*files, state / 'compose.e2e.json']
    return run(['sudo', 'env', f'TRANSFER_DIR={environment["TRANSFER_DIR"]}', f'PUBLIC_HOST={HOST}',
                f'PUBLIC_ORIGIN={ORIGIN}', 'docker', 'compose', '--profile', 'operations', '--profile', 'live',
                '--profile', 'workers', '--profile', 'tournament-workers',
                '--env-file', args.project / 'docker/production.env', '-p', PROJECT,
                *(item for file in files for item in ('-f', str(file))), *extra, *command], capture=capture)


def verify_config(args, state, database_transition=False):
    session = json.loads((state / 'session.json').read_text())
    select_services(session['identity'])
    config = json.loads(compose(args, state, 'config', '--format', 'json', capture=True))
    require(config['name'] == PROJECT and config['networks']['application']['internal'] is True,
            'Expected the isolated copied rehearsal project')
    require(not config['services']['postgres'].get('ports') and not config['services']['redis'].get('ports'),
            'Database/cache ports must not be published')
    require(same_directory(session['project_dir'], args.project)
            and same_directory(session['rehearsal_dir'], args.rehearsal),
            'Session paths differ from the prepared target')
    context = session['identity'].get('database_context')
    if context is not None:
        require_browser_database_context(session['identity'])
    planned = fresh_database_context(session['identity']['session_id']) if database_transition else None
    for service, image in SERVICES.items():
        require(config['services'][service]['image'] == session['identity']['images'][image], 'Application image differs from the pinned release')
        if image in ('game', 'tournaments'):
            env = config['services'][service]['environment']
            kind = image
            expected = context['databases'][kind] if context else 'backgammon_' + kind
            names = {expected, 'backgammon_' + kind, planned['databases'][kind]} if planned else {expected}
            expected_redis = f'redis://redis:6379/{context["redis_databases"][kind]}' if context else f'redis://redis:6379/{0 if kind == "game" else 1}'
            redis_urls = {expected_redis, f'redis://redis:6379/{planned["redis_databases"][kind]}'} if planned else {expected_redis}
            require(env['DB_HOST'] == 'postgres' and env['DB_NAME'] in names
                    and env['DB_USER'] == 'backgammon_' + kind and env['REDIS_URL'] in redis_urls,
                    'Application database/cache is outside the prepared rehearsal')
            key = 'GAMELINK_TOURNAMENTS_URL' if kind == 'game' else 'GAMELINK_BACKGAMMON_URL'
            require(env[key] == ORIGIN, 'Callback origin differs from the test Nginx listener')
    verify_integration_config(session['identity'], config)
    return session


def verify_live(session):
    select_services(session['identity'])
    context = require_browser_database_context(session['identity'])
    integration = require_integration_context(session['identity'])
    for service in APPS + WORKERS:
        state = inspect(service)
        require(state['project'] == PROJECT and state['service'] == service and state['status'] == 'running'
                and state['image'] == session['identity']['images'][SERVICES[service]], f'Wrong running container: {service}')
        if service in APPS:
            require(state['health'] == 'healthy', f'Unhealthy application: {service}')
        kind = SERVICES[service]
        if kind in ('game', 'tournaments', 'analysis'):
            values = json.loads(docker('inspect', PROJECT + '-' + service + '-1', '--format',
                                       '{{json .Config.Env}}', capture=True))
            selected = {key: value for key, value in (item.split('=', 1) for item in values)
                        if key in ('DB_HOST', 'DB_NAME', 'DB_USER', 'REDIS_URL')}
            expected = {'DB_HOST': 'postgres', 'DB_NAME': integration['analysis_database'] if kind == 'analysis'
                        else context['databases'][kind], 'DB_USER': 'backgammon_' + kind}
            if kind != 'analysis':
                expected['REDIS_URL'] = f'redis://redis:6379/{context["redis_databases"][kind]}'
            require(selected == expected,
                    'Running container uses a different database/cache context: ' + service)
            if service in ('game-api', 'tournaments-api'):
                observer = {key: value for key, value in (item.split('=', 1) for item in values)
                            if key in ('DJANGO_SETTINGS_MODULE', 'E2E_ADMISSION_KIND', 'PYTHONPATH')}
                require(observer == {'DJANGO_SETTINGS_MODULE': 'rehearsal_settings',
                                     'E2E_ADMISSION_KIND': kind, 'PYTHONPATH': '/opt/e2e'},
                        'Running API is missing the entry observer: ' + service)


def wait_application_health(session, deadline, bootstrap=False):
    services = APPS if bootstrap else APPS + WORKERS
    while True:
        pending = {}
        for service in services:
            value = inspect(service)
            require(value['project'] == PROJECT and value['service'] == service
                    and value['image'] == session['identity']['images'][SERVICES[service]],
                    f'Container identity changed: {service}')
            if value['status'] != 'running':
                pending[service] = value['status']
            elif service in APPS and value['health'] != 'healthy':
                pending[service] = value['health']
        if not pending:
            return
        require(time.monotonic() < deadline, 'Application health timeout: ' + json.dumps(pending))
        time.sleep(min(3, max(0, deadline - time.monotonic())))


def app(args, state, kind, action):
    compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate',
            'python', '/opt/e2e/rehearsal_app.py', kind, action)


def run_database_audits(args, state, session, summary, operations_file):
    """Persist every independent audit; an earlier failure cannot hide later checks."""
    operations = json.loads(operations_file.read_text())
    steps = {}
    operations.update(database_audits_passed=False, audit_steps=steps)

    def save_operations():
        operations_file.write_text(json.dumps(operations, indent=2) + '\n', encoding='utf-8')
        operations_file.chmod(0o600)

    def step(label, kind, action, operation):
        report_file = state / 'audit' / (summary['runId'] + '-' + kind + '-' + action + '.json')
        require(not report_file.is_symlink(), 'Unsafe audit report')
        previous_time = report_file.stat().st_mtime_ns if report_file.exists() else None
        previous_content = run(['sudo', 'cat', report_file], capture=True) if report_file.exists() else None
        value = {'status': 'running'}
        steps[label] = value
        save_operations()
        try:
            operation()
        except subprocess.CalledProcessError as exc:
            value.update(status='failed', exit_code=exc.returncode)
        else:
            value['status'] = 'passed'
        current_content = run(['sudo', 'cat', report_file], capture=True) if report_file.exists() else None
        if current_content is not None and (current_content != previous_content
                                            or report_file.stat().st_mtime_ns != previous_time):
            report = json.loads(current_content)
            require(report.get('session_id') == session['identity']['session_id']
                    and report.get('run_id') == summary['runId'] and report.get('kind') == kind,
                    'Saved audit report belongs to another run')
            value['report'] = report
            if report.get('passed') is not True:
                value['status'] = 'failed'
        elif value['status'] == 'passed':
            value.update(status='failed', reason='No fresh structured report was saved')
        save_operations()
        return value['status'] == 'passed'

    game = step('game', 'game', 'audit', lambda: app(args, state, 'game', 'audit'))
    tournaments = step('tournaments', 'tournaments', 'audit', lambda: app(args, state, 'tournaments', 'audit'))
    if require_integration_context(session['identity']):
        step('analysis', 'analysis', 'audit', lambda: compose(args, state,
            'run', '-T', '--interactive=false', '--rm', '--no-deps', 'analysis-migrate',
            'python', '/opt/e2e/rehearsal_integrations.py', 'proof'))
    if game and tournaments:
        replay = step('duplicate_results', 'game', 'replay', lambda: app(args, state, 'game', 'replay'))
        if replay:
            step('wallet_after_replay', 'tournaments', 'audit', lambda: app(args, state, 'tournaments', 'audit'))
        else:
            steps['wallet_after_replay'] = {'status': 'skipped', 'reason': 'Duplicate-result replay failed'}
    else:
        steps['duplicate_results'] = {'status': 'skipped', 'reason': 'Initial database audit failed'}
        steps['wallet_after_replay'] = {'status': 'skipped', 'reason': 'Duplicate-result replay was not performed'}
    operations['database_audits_passed'] = all(value['status'] == 'passed' for value in steps.values())
    operations['background_workers'] = {kind: steps[kind].get('report', {}).get('background_workers')
                                        for kind in ('game', 'tournaments')}
    save_operations()
    print('SERVER AUDIT RESULT: ' + str(operations_file))
    require(operations['database_audits_passed'], 'Server audit failed; details and skipped checks are saved in audit_steps')


def collect_operations(args, state, session, label):
    from server_inventory import collect as inventory
    from server_schedule_audit import collect as schedules
    require(re.fullmatch(r'[A-Za-z0-9_-]+', label), 'Unsafe operations report label')
    report = {'session_id': session['identity']['session_id'], 'run_id': label,
              'read_only': True, 'inventory': inventory(args), 'schedules': schedules()}
    path = state / 'audit' / ('operations-' + label + '.json')
    require(not path.is_symlink(), 'Unsafe operations report path')
    path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)
    print('COMPREHENSIVE SERVER OPERATIONS REPORT: ' + str(path))
    require(not report['inventory']['findings'] and report['inventory'].get('harness_matches') is True,
            'Application inventory alignment failed; inspect the saved operations report')
    return path


def validate_listener_response(path, response, identity):
    headers, separator, body = response.replace('\r\n', '\n').partition('\n\n')
    lines = headers.splitlines()
    require(separator and lines and re.match(r'^HTTP/\S+\s+200(?:\s|$)', lines[0]),
            'Nginx must return HTTP 200: ' + path)
    values = {key.lower(): value.strip() for key, value in
              (line.split(':', 1) for line in lines[1:] if ':' in line)}
    content_type = values.get('content-type', '').split(';', 1)[0].lower()
    if path in ('/backgammon/', '/tournaments/', '/tournaments-admin/'):
        require(content_type == 'text/html' and '<script' in body.lower(), 'Frontend HTML is missing: ' + path)
        return
    require(content_type == 'application/json', 'Expected API JSON through Nginx: ' + path)
    payload = json.loads(body)
    if path == '/__e2e__/identity':
        require(payload == identity, 'Nginx listener has an unexpected identity')
    elif path == '/tournaments-api/csrf/':
        require(payload.get('detail') == 'CSRF cookie set'
                and any(line.lower().startswith('set-cookie: csrftoken=') for line in lines),
                'Nginx did not deliver the Django CSRF cookie')
    else:
        require(path in ('/backgammon/api/health/', '/tournaments-api/health/')
                and payload.get('status') == 'ok', 'API health through Nginx failed: ' + path)


def check_listener(session):
    active = run(['sudo', 'cat', CONF], capture=True)
    expected = nginx(session['identity'], discover_upstreams(session))
    if session['identity'].get('load_cleanup_version') == 1:
        expected = (Path(session['rehearsal_dir']) / 'browser-load/nginx.candidate.conf').read_text()
    require(active.strip() == expected.strip(),
            'Test Nginx upstreams differ from current containers; use stop then start to refresh them')
    # Force the local host gateway without relying on public hairpin routing.
    for path in ('/__e2e__/identity', '/backgammon/api/health/', '/tournaments-api/health/',
                 '/tournaments-api/csrf/', '/backgammon/', '/tournaments/', '/tournaments-admin/'):
        response = run(['curl', '--fail', '--silent', '--show-error', '--include', '--max-time', '10',
                        '--noproxy', '*', '--resolve', f'{HOST}:18443:127.0.0.1', ORIGIN + path], capture=True)
        validate_listener_response(path, response, session['identity'])
    print('Nginx HTTPS APIs, CSRF cookie and all three application frontends verified.')


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
    parser.add_argument('action', choices=('prepare', 'finish-prepare', 'fresh-databases', 'start', 'check', 'baseline', 'monitoring', 'monitoring-restore', 'audit', 'entry-report', 'stop', 'refresh-tools', 'prepare-load', 'begin-load', 'finish-load', 'cleanup-load'))
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--rehearsal', required=True, type=Path)
    parser.add_argument('--summary', type=Path)
    parser.add_argument('--copied-load', action='store_true', help='Use the opt-in browser-load state on copied candidate data')
    parser.add_argument('--tools-revision', help='Full approved clean Git commit for a running-session tool update')
    args = parser.parse_args()
    args.project, args.rehearsal = args.project.resolve(), args.rehearsal.resolve()
    configure_target(args)
    tools = Path(__file__).resolve().parent
    load_action = args.action in ('prepare-load', 'begin-load', 'finish-load', 'cleanup-load')
    require(not load_action or args.copied_load, 'Load actions require --copied-load')
    require(not args.copied_load or args.action in ('prepare-load', 'begin-load', 'finish-load', 'cleanup-load', 'check'),
            'Copied load cannot reset databases, start a different session, or refresh audit baselines')
    state = args.rehearsal / ('browser-load' if args.copied_load else 'browser-e2e-r2')
    if args.action == 'prepare-load':
        from copied_load import prepare as prepare_load
        prepare_load(__import__(__name__), args, state, tools)
        return
    if args.action == 'prepare':
        prepare(args, state, tools)
        return
    session = verify_config(args, state, database_transition=args.action == 'fresh-databases')
    if args.action in ('begin-load', 'finish-load', 'cleanup-load'):
        from copied_load import begin as begin_load, finish as finish_load
        require_browser_database_context(session['identity'])
        if args.action == 'begin-load':
            require(args.summary and args.summary.is_file(), 'Pass the new browser load plan')
            verify_live(session)
            check_listener(session)
            begin_load(__import__(__name__), args, state, session)
        else:
            finish_load(__import__(__name__), args, state, session, cleanup_only=args.action == 'cleanup-load')
        return
    if args.action == 'refresh-tools':
        refresh_tools(args, state, tools, session)
        return
    if args.action == 'fresh-databases':
        fresh_databases(args, state, tools, session)
        return
    if args.action == 'finish-prepare':
        finish_prepare(args, state, tools, session)
        return
    if args.action == 'monitoring-restore':
        restore_monitoring(state)
        return
    if args.action == 'start':
        require_fresh_database_context(session['identity'])
        require(not CONF.exists(), 'Test listener is already installed; use check instead of starting twice')
        verify_existing_app_identities(session)
        # Retry a partially completed setup only within this pinned rehearsal.
        compose(args, state, 'stop', *WORKERS, *APPS)
        refresh_prepared_harness(state, tools, session)
        for kind in ('game', 'tournaments', *(['analysis'] if require_integration_context(session['identity']) else [])):
            compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate')
        app(args, state, 'tournaments', 'seed')
        for kind in ('game', 'tournaments'):
            app(args, state, kind, 'baseline')
        deadline = time.monotonic() + 180
        installed = False
        try:
            # A stopped old container retains its old mounts/command with --no-recreate.
            # Recreate only APIs so the reviewed observer is actually loaded.
            apis = ['game-api', 'tournaments-api'] + (['analysis-api'] if require_integration_context(session['identity']) else [])
            compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', *apis)
            compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--no-recreate', *APPS)
            wait_application_health(session, deadline, bootstrap=True)
            refresh_nginx_candidate(state, session)
            # No public-production Nginx block is edited. Only this new test file is installed.
            run(['sudo', 'install', '-m', '0644', state / 'nginx.candidate.conf', CONF])
            installed = True
            run(['sudo', 'nginx', '-t'])
            run(['sudo', 'systemctl', 'reload', 'nginx'])
            check_listener(session)
            for kind in ('game', 'tournaments'):
                compose(args, state, 'run', '-T', '--interactive=false', '--rm', '--no-deps', kind + '-migrate',
                    'python', '-c', 'import json,urllib.request; '
                    'target=json.load(open("/opt/e2e/session.json"))["identity"]; '
                    'assert json.load(urllib.request.urlopen(target["origin"]+"/__e2e__/identity",timeout=10))==target; '
                    'print("Container HTTPS callback route verified.")')
            recreate = '--force-recreate' if require_integration_context(session['identity']) else '--no-recreate'
            compose(args, state, 'up', '-d', '--no-build', '--no-deps', recreate, *WORKERS)
            wait_application_health(session, deadline)
            verify_live(session)
            check_listener(session)
        except Exception:
            if installed:
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
        collect_operations(args, state, session, 'baseline')
        print('Idle baseline ready. Start a NEW browser run before refreshing this baseline again.')
        return
    if args.action == 'check':
        compose(args, state, 'ps')
        print('Pinned container identities, health and host Nginx test listener verified.')
        return
    if args.action == 'monitoring':
        monitoring(state, tools)
        return
    require(args.summary and args.summary.is_file(), 'Pass the completed browser tournament-summary.json')
    summary = json.loads(args.summary.read_text(encoding='utf-8'))
    require(summary.get('targetSession') == session['identity']['session_id']
            and re.fullmatch(r'[A-Za-z0-9_-]{10,80}', summary.get('runId', '')), 'Invalid uploaded browser run')
    export_entry_report(state, session, summary)
    if args.action == 'entry-report':
        return
    operations_file = collect_operations(args, state, session, summary['runId'])
    destination = state / 'audit/tournament-summary.json'
    if destination.exists():
        destination.unlink()
    write(destination, summary)
    destination.chmod(0o644)
    run_database_audits(args, state, session, summary, operations_file)
    print('SERVER DATABASE AND DUPLICATE-RESULT AUDIT PASSED. Combine with the browser performance acceptance report.')


if __name__ == '__main__':
    main()
