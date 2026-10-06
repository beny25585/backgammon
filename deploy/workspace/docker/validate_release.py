"""User-run stages 1--4. No production cutover, cron edits, or volume deletion."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from types import SimpleNamespace
from urllib.parse import urlsplit

from validation_support import Postgres, Stages, command, declared_asset_sources, read, require, save, sha, timestamp

ROOT = Path('/home/dev/backgammon-project')
OLD_PROJECT = 'backgammon-rehearsal-20261005t184922z'
OLD_TAG = 'bg-20261005-git-r2'
OLD_REHEARSAL = ROOT / 'backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal'
ORIGIN = 'https://38.247.146.17.nip.io:18443'
MANUAL = {
    'device_push': 'Enable Push and receive a notification on your own test device.',
    'mobile': 'Play and use the candidate on the physical mobile device.',
    'direct_friend': 'Complete direct and friend game flows in the candidate UI.',
    'ai_practice_fee': 'Complete an AI practice game and verify one coin debit.',
    'admin_refund_no_show': 'Exercise admin controls, cancellation/refund and no-show in test accounts.',
    'legacy_review': 'Review restored open rooms/deadlines and the old failed analysis; record the disposition.',
}


def console_command(args, label):
    print('RUN: ' + label, flush=True)
    with subprocess.Popen([str(item) for item in args], stderr=subprocess.STDOUT) as process:
        while process.poll() is None:
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                # Keep the already granted sudo ticket alive during a long user-run build.
                subprocess.run(['sudo', '-n', '-v'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print('Still working: ' + label, flush=True)
        require(process.returncode == 0,
                f'{label} failed with exit code {process.returncode}; see output above')


class Validation:
    def __init__(self, root=ROOT):
        require(Path(root).resolve() == ROOT, 'Only the existing managed server layout is supported')
        self.workspace = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(self.workspace / 'docs/tournament-e2e'))
        self.repository = self.workspace.parents[1]
        self.release = read(self.workspace / 'release.json')
        self.tag = self.release['image_tag']
        require(re.fullmatch(r'backgammon-[a-z0-9-]{1,36}', self.tag) and self.tag != OLD_TAG, 'Choose a new candidate tag')
        git = ['git', '-c', 'safe.directory=' + str(self.repository), '-C', self.repository]
        self.revision = command([*git, 'rev-parse', 'HEAD'], text=True).strip()
        require(not command([*git, 'status', '--porcelain', '--untracked-files=all'], text=True).strip(),
                'Validation tools must come from the clean published Git commit')
        self.directory = ROOT / 'reports/release-validation' / self.tag
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        file = self.directory / 'plan.json'
        if file.exists():
            self.plan = read(file)
            require(self.plan['release'] == self.release and self.plan['infrastructure_revision'] == self.revision,
                    'This candidate tag belongs to a different immutable source; select a new tag')
        else:
            self.plan = {'validation_id': uuid.uuid4().hex, 'release': self.release,
                         'infrastructure_revision': self.revision, 'created_at': timestamp()}
            save(file, self.plan)
        self.id = self.plan['validation_id']
        self.project = ROOT / 'deploy/backgammon-deploy' / self.tag
        self.rehearsal = ROOT / 'backups/backgammon-backups' / ('validation-' + self.id) / 'docker-rehearsal'
        self.state = self.rehearsal / 'browser-e2e-r2'
        self.name = 'backgammon-candidate-' + self.id
        self.tools = self.project / 'docs/tournament-e2e'
        self.stages = Stages(self.directory, self.plan)
        self.stages.report.pop('private_logs_directory', None)
        save(self.stages.file, self.stages.report)

    def run(self, label, args):
        console_command(args, label)

    def base_compose(self, *args):
        return ['sudo', 'env', 'TRANSFER_DIR=' + str(self.rehearsal / 'transfer-v2'),
                'PUBLIC_HOST=38.247.146.17.nip.io', 'PUBLIC_ORIGIN=' + ORIGIN,
                'docker', 'compose', '--profile', 'operations', '--profile', 'live', '--profile', 'workers',
                '--profile', 'tournament-workers', '--env-file', self.project / 'docker/production.env',
                '-p', self.name, '-f', self.project / 'docker/compose.production.yaml',
                '-f', self.rehearsal / 'compose.override.yaml', *args]

    def tool(self, action, integrations=False):
        file = 'rehearsal_integrations.py' if integrations else 'server_rehearsal.py'
        self.run(action, ['python3', self.tools / file, action, '--project', self.project,
                          '--rehearsal', self.rehearsal, *(['--retry-restored'] if integrations else [])])

    def backup(self):
        old = read(OLD_REHEARSAL / 'browser-e2e-r2/session.json')
        require(old['identity']['project'] == OLD_PROJECT and old['identity']['origin'] == ORIGIN,
                'The old browser rehearsal identity differs')
        from rehearsal_context import require_fresh_database_context
        from rehearsal_integrations import require_integration_context
        context = require_fresh_database_context(old['identity'])
        integration = require_integration_context(old['identity'])
        require(integration is not None, 'Snapshot requires the existing complete integration rehearsal')
        db = Postgres(OLD_PROJECT)
        folder = self.rehearsal / ('backup-' + uuid.uuid4().hex[:8])
        folder.mkdir(mode=0o700, parents=True)
        writers, roots = [], set()
        for service in ('game-api', 'tournaments-api', 'analysis-api', 'game-tasks',
                        'tournaments-tasks', 'analysis-worker', 'push-worker', 'postgres', 'tournaments-frontend'):
            name = OLD_PROJECT + '-' + service + '-1'
            value = json.loads(command(['sudo', 'docker', 'inspect', name, '--format',
                '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                '"running":{{json .State.Running}},"mounts":{{json .Mounts}}}'], text=True))
            require(value['project'] == OLD_PROJECT and value['service'] == service, 'Wrong snapshot container')
            if value['running'] and service not in ('postgres', 'tournaments-frontend'):
                writers.append(name)
            roots.update(declared_asset_sources(value['mounts']))
        require(writers and roots, 'Missing rehearsal writers or declared secret/media mounts')
        names = {'backgammon_game', 'backgammon_tournaments', 'backgammon_analysis',
                 *context['databases'].values(), integration['analysis_database']}
        save(folder / 'asset-roots.json', sorted(roots))
        records = {}
        stopped = False
        try:
            stopped = True
            self.run('quiesce-snapshot-writers', ['sudo', 'docker', 'stop', '--time', '45', *writers])
            for name in sorted(names):
                role = db.sql('postgres', f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='{name}'")
                require(role in ('backgammon_game', 'backgammon_tournaments', 'backgammon_analysis'),
                        'Missing or unexpected rehearsal database owner')
                file = folder / (name + '.dump')
                db.dump(name, file)
                records[name] = {'owner': role, 'dump': str(file), 'sha256': sha(file),
                                 'fingerprint': db.fingerprint(name), 'sequences': db.sequences(name)}
            with (folder / 'roles.private.sql').open('xb') as stream:
                os.chmod(stream.name, 0o600)
                subprocess.run([*db.prefix, 'pg_dumpall', '-U', 'postgres', '--globals-only'], stdout=stream, check=True)
            assets = json.loads(command(['sudo', 'python3', self.workspace / 'docker/validation_support.py',
                '--assets', folder / 'asset-roots.json', '--output', folder / 'assets'], text=True))
        finally:
            if stopped:
                self.run('restore-snapshot-writers', ['sudo', 'docker', 'start', *writers])
                self.refresh_old_listener(old)
        result = {'directory': str(folder), 'databases': records, 'assets': assets,
                  'session_id': old['identity']['session_id'], 'writers_quiesced': True}
        save(folder / 'backup.json', result)
        return result

    def refresh_old_listener(self, old):
        # Host module uses public identity only; never import the old application settings.
        sys.path.insert(0, str(self.workspace / 'docs/tournament-e2e'))
        import server_rehearsal as server
        server.configure_target(SimpleNamespace(project=ROOT / 'deploy/backgammon-deploy' / OLD_TAG,
                                                 rehearsal=OLD_REHEARSAL))
        server.select_services(old['identity'])
        server.wait_application_health(old, time.monotonic() + 180, bootstrap=True)
        if server.CONF.exists():
            current = command(['sudo', 'cat', server.CONF], text=True)
            require('Session ' + old['identity']['session_id'] in current, 'Test listener changed during snapshot')
            candidate = self.directory / 'old-listener-refreshed.conf'
            candidate.write_text(server.nginx(old['identity'], server.discover_upstreams(old)))
            # An IP-only refresh must not replace an unrelated routing change.
            normalized = lambda text: re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '<ip>', text.strip())
            require(normalized(current) == normalized(candidate.read_text()), 'Old test routing changed beyond upstream IPs')
            self.install_listener(server, candidate, {old['identity']['session_id']})

    def install_listener(self, server, candidate, sessions):
        previous = command(['sudo', 'cat', server.CONF], text=True) if server.CONF.exists() else None
        if previous is not None:
            require(any('Session ' + value in previous for value in sessions), 'Refusing an unrelated test listener')
        try:
            self.run('install-test-listener', ['sudo', 'install', '-m', '0644', candidate, server.CONF])
            self.run('nginx-test', ['sudo', 'nginx', '-t'])
            self.run('nginx-reload', ['sudo', 'systemctl', 'reload', 'nginx'])
        except BaseException:
            if previous is not None:
                backup = self.directory / ('listener-rollback-' + uuid.uuid4().hex[:8] + '.conf')
                backup.write_text(previous)
                self.run('restore-test-listener-file', ['sudo', 'install', '-m', '0644', backup, server.CONF])
            else:
                self.run('remove-failed-test-listener', ['sudo', 'rm', '--', server.CONF])
            self.run('rollback-nginx-test', ['sudo', 'nginx', '-t'])
            self.run('rollback-nginx-reload', ['sudo', 'systemctl', 'reload', 'nginx'])
            raise

    def workspace_and_build(self):
        if not (self.project / '.workspace-release.json').exists():
            self.run('prepare-workspace', ['python3', self.workspace / 'prepare_workspace.py',
                                           '--destination', self.project, '--resume',
                                           '--source-root', ROOT.parent, '--pull'])
        record = read(self.project / '.workspace-release.json')
        require(record['infrastructure_revision'] == self.revision and record['sources'] == self.release['sources'],
                'Prepared candidate source revisions differ')
        old_environment = (ROOT / 'deploy/backgammon-deploy' / OLD_TAG / 'docker/production.env').read_text()
        public = {}
        for key in ('PUBLIC_HOST', 'PUBLIC_ORIGIN'):
            values = re.findall(r'^' + key + r'=(.+)$', old_environment, re.MULTILINE)
            require(len(values) == 1, 'Existing public origin/host configuration is missing or ambiguous')
            public[key] = values[0].strip()
        origin = urlsplit(public['PUBLIC_ORIGIN'])
        require(origin.scheme == 'https' and origin.hostname == public['PUBLIC_HOST']
                and origin.port in (None, 443) and not origin.username and not origin.password
                and not origin.query and not origin.fragment and origin.path in ('', '/'),
                'Review the existing production URL before building the candidate')
        environment_file = self.project / 'docker/production.env'
        environment = environment_file.read_text()
        for key, value in public.items():
            require(len(re.findall(r'^' + key + r'=', environment, re.MULTILINE)) == 1,
                    'Candidate public configuration is ambiguous')
            environment = re.sub(r'^' + key + r'=.*$', lambda match: key + '=' + value, environment, flags=re.MULTILINE)
        environment_file.write_text(environment, encoding='utf-8')
        environment_file.chmod(0o600)
        if not (self.project / '.built-images.json').exists():
            self.run('build-seven-images', ['bash', self.project / 'docker/build_on_server.sh'])
        self.run('verify-images', ['python3', self.project / 'docker/release_images.py', '--sudo-docker'])
        built = read(self.project / '.built-images.json')
        require(built['infrastructure_revision'] == self.revision and built['sources'] == self.release['sources'],
                'Built images belong to different sources')
        return {'images': built['images'], 'image_tag': self.tag, 'sources': built['sources'],
                'existing_public_configuration_preserved': public}

    def infrastructure(self):
        self.rehearsal.mkdir(parents=True, mode=0o700, exist_ok=True)
        (self.rehearsal / 'transfer-v2').mkdir(mode=0o700, exist_ok=True)
        target = {'validation_id': self.id, 'project': self.name, 'origin': ORIGIN,
                  'image_tag': self.tag, 'infrastructure_revision': self.revision,
                  'sources': self.release['sources'], 'project_dir': str(self.project)}
        save(self.rehearsal / 'validation-target.json', target)
        # Carry only the existing secret directory path, never secret values into Git/reports.
        old_env = (ROOT / 'deploy/backgammon-deploy' / OLD_TAG / 'docker/production.env').read_text()
        config_dirs = re.findall(r'^CONFIG_DIR=(.+)$', old_env, re.MULTILINE)
        require(len(config_dirs) == 1 and config_dirs[0].strip() == '/etc/backgammon-docker',
                'Review the existing secret directory before preparing a candidate')
        override = 'services:\n'
        for service in ('postgres', 'redis', 'dice', 'game-api', 'tournaments-api', 'analysis-api',
                        'game-frontend', 'tournaments-frontend', 'admin-frontend'):
            override += f'  {service}:\n    ports: !reset []\n    cpus: 1.0\n'
        override += 'networks:\n  application:\n    internal: true\n'
        (self.rehearsal / 'compose.override.yaml').write_text(override, encoding='utf-8')
        self.run('isolated-infrastructure', self.base_compose('up', '-d', '--no-build', 'postgres', 'redis'))
        deadline = time.monotonic() + 180
        while True:
            try:
                Postgres(self.name)
                break
            except (ValueError, subprocess.CalledProcessError):
                require(time.monotonic() < deadline, 'Candidate PostgreSQL did not become healthy')
                time.sleep(2)
        return {'project': self.name, 'ports_published': False}

    def oneoff(self, kind, action, job):
        folder = self.directory / ('check-' + uuid.uuid4().hex[:8])
        folder.mkdir(mode=0o700)
        output = folder / 'output'
        output.mkdir()
        self.run('grant-check-output', ['sudo', 'chgrp', '10001', output])
        output.chmod(0o770)
        save(folder / 'job.json', dict(job, kind=kind, validation_id=self.id))
        (folder / 'job.json').chmod(0o644)
        options = ['run', '-T', '--interactive=false', '--rm', '--no-deps',
                   '-v', str(self.tools / 'validation_checks.py') + ':/opt/validation/checks.py:ro',
                   '-v', str(folder / 'job.json') + ':/opt/validation/job.json:ro',
                   '-v', str(output) + ':/data/validation']
        config = {'SECRET_KEY': uuid.uuid4().hex + uuid.uuid4().hex, 'GAMELINK_ENABLED': '0',
                  'EMAIL_BACKEND': 'django.core.mail.backends.dummy.EmailBackend',
                  'TRANZILA_ENABLED': '0', 'TRANZILA_PURCHASES_ENABLED': '0',
                  'WEB_PUSH_PRIVATE_KEY': '', 'WEB_PUSH_PUBLIC_KEY': '', 'GOOGLE_CLIENT_ID': '',
                  'ANALYSIS_SERVICE_URL': 'http://analysis.invalid', 'AI_SERVICE_URL': '',
                  'ANALYSIS_API_TOKEN': uuid.uuid4().hex, 'APP_LOG_LEVEL': 'WARNING'}
        save(folder / 'config.json', config)
        (folder / 'config.json').chmod(0o644)
        options += ['-e', 'DB_NAME=' + job['database'], '-e', 'RUNTIME_CONFIG_FILE=/opt/validation/config.json',
                    '-v', str(folder / 'config.json') + ':/opt/validation/config.json:ro']
        self.run(action, self.base_compose(*options, kind + '-migrate', 'python',
                                         '/opt/validation/checks.py', action, '/opt/validation/job.json'))
        return read(output / 'result.json')

    def restore_and_migrate(self):
        backup = self.stages.report['stages']['snapshot']['result']
        db = Postgres(self.name)
        results = []
        for index, (source, record) in enumerate(backup['databases'].items()):
            require(sha(record['dump']) == record['sha256'], 'A preserved PostgreSQL dump changed')
            name = f'bgv_restore_{self.id[:12]}_{index}_{uuid.uuid4().hex[:6]}'
            marker = f'backgammon-validation:{self.id}:restore:{name}'
            db.create(name, record['owner'], marker)
            db.restore(record['dump'], name, record['owner'])
            require(db.fingerprint(name) == record['fingerprint'], 'Restored PostgreSQL fields/rows differ')
            require(db.sequences(name) == record['sequences'], 'Restored PostgreSQL identifier sequences differ')
            kind = record['owner'].removeprefix('backgammon_')
            migrated = self.oneoff(kind, 'migrate', {'database': name, 'marker': marker})
            columns = {table: names for table, names in record['fingerprint']['columns'].items()
                       if table not in ('django_migrations', 'django_content_type', 'auth_permission')}
            after = db.fingerprint(name, columns)
            expected = {table: rows for table, rows in record['fingerprint']['tables'].items() if table in columns}
            require(after['tables'] == expected, 'Migration changed existing business fields or records')
            results.append({'source': source, 'restored_database': name, 'restored_and_verified': True,
                            'business_data_preserved': True, 'migration': migrated})
        return {'databases': results, 'assets': backup['assets'], 'live_databases_modified': False}

    def application_tests(self):
        db = Postgres(self.name)
        results = []
        for kind in ('game', 'tournaments'):
            name = f'bgv_test_{self.id[:12]}_{kind}_{uuid.uuid4().hex[:6]}'
            marker = f'backgammon-validation:{self.id}:test:{name}'
            db.create(name, 'backgammon_' + kind, marker)
            results.append(self.oneoff(kind, 'tests', {'database': name, 'marker': marker}))
        return {'passed': all(row['passed'] for row in results), 'checks': results}

    def activate(self):
        try:
            return self.activate_candidate()
        except BaseException:
            self.restore_test()
            raise

    def restore_test(self):
        sys.path.insert(0, str(self.workspace / 'docs/tournament-e2e'))
        import server_rehearsal as server
        old_args = SimpleNamespace(project=ROOT / 'deploy/backgammon-deploy' / OLD_TAG, rehearsal=OLD_REHEARSAL)
        old = read(OLD_REHEARSAL / 'browser-e2e-r2/session.json')
        if server.CONF.exists():
            active = command(['sudo', 'cat', server.CONF], text=True)
            if 'Session ' + old['identity']['session_id'] not in active:
                candidate = read(self.state / 'session.json')
                require('Session ' + candidate['identity']['session_id'] in active
                        and candidate['identity']['validation_id'] == self.id, 'Refusing to remove an unrelated listener')
                self.run('remove-candidate-test-listener', ['sudo', 'rm', '--', server.CONF])
                self.run('nginx-test', ['sudo', 'nginx', '-t'])
                self.run('nginx-reload', ['sudo', 'systemctl', 'reload', 'nginx'])
        self.run('stop-candidate-apps', self.base_compose('stop', *server.BASE_APPS,
                 *server.BASE_WORKERS, 'analysis-api', 'analysis-worker', 'push-worker'))
        server.configure_target(old_args)
        server.select_services(old['identity'])
        server.compose(old_args, OLD_REHEARSAL / 'browser-e2e-r2', 'up', '-d', '--no-build',
                       '--no-deps', '--no-recreate', *server.APPS, *server.WORKERS)
        server.wait_application_health(old, time.monotonic() + 180, bootstrap=True)
        candidate = self.directory / 'restored-old-test-listener.conf'
        candidate.write_text(server.nginx(old['identity'], server.discover_upstreams(old)))
        self.install_listener(server, candidate, {old['identity']['session_id']})
        server.verify_live(old)
        server.check_listener(old)
        self.stages.report['passed'] = False
        for name in ('candidate_activation', 'public_assets', 'service_recovery'):
            if self.stages.report['stages'].get(name, {}).get('status') == 'passed':
                self.stages.report['stages'][name]['status'] = 'restored'
        save(self.stages.file, self.stages.report)
        print('Previous test listener restored; candidate databases, volumes and reports preserved.')

    def activate_candidate(self):
        # Only the old test listener is stopped; old databases and container volumes remain.
        import server_rehearsal as server
        if server.CONF.exists():
            active = command(['sudo', 'cat', server.CONF], text=True)
            old = read(OLD_REHEARSAL / 'browser-e2e-r2/session.json')
            if 'Session ' + old['identity']['session_id'] in active:
                self.run('stop-old-test-listener', ['python3', self.tools / 'server_rehearsal.py', 'stop',
                    '--project', ROOT / 'deploy/backgammon-deploy' / OLD_TAG, '--rehearsal', OLD_REHEARSAL])
        if not (self.state / 'session.json').exists():
            self.tool('prepare')
        if not (self.state / 'server-client.json').exists():
            self.tool('finish-prepare')
        session = read(self.state / 'session.json')
        if 'integrations' in session['identity'] and not server.CONF.exists():
            # Resume the same completed session without replacing audit baselines or seeding accounts again.
            args = SimpleNamespace(project=self.project, rehearsal=self.rehearsal)
            server.configure_target(args)
            server.verify_config(args, self.state)
            server.compose(args, self.state, 'up', '-d', '--no-build', '--no-deps', '--no-recreate',
                           *server.APPS, *server.WORKERS)
            server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
            server.refresh_nginx_candidate(self.state, session)
            self.install_listener(server, self.state / 'nginx.candidate.conf', {session['identity']['session_id']})
        if 'database_context' not in session['identity']:
            self.tool('fresh-databases')
        session = read(self.state / 'session.json')
        if 'integrations' not in session['identity']:
            conf = Path('/etc/nginx/conf.d/backgammon-rehearsal-e2e.conf')
            if not conf.exists():
                self.tool('start')
            self.tool('enable', integrations=True)
        self.tool('check')
        session = read(self.state / 'session.json')
        require(session['identity']['validation_id'] == self.id, 'Candidate session identity changed')
        save(self.directory / 'client-location.json', {'validation_id': self.id,
            'manifest': str(self.state / 'server-client.json'), 'session_id': session['identity']['session_id']})
        return {'session_id': session['identity']['session_id'], 'manifest': str(self.state / 'server-client.json')}

    def frontend_checks(self):
        import urllib.request
        session = read(self.state / 'session.json')
        paths = ['/tournaments/push-sw.js', '/tournaments/pwa-icon-192.png',
                 '/backgammon/sw.js', '/backgammon/manifest.webmanifest']
        for path in paths:
            with urllib.request.urlopen(ORIGIN + path, timeout=15) as response:
                body = response.read()
                require(response.status == 200 and len(body) > 20, 'Public PWA asset is unavailable')
                if path.endswith('.png'):
                    require(body.startswith(b'\x89PNG\r\n\x1a\n'), 'PWA icon returned a different file')
                elif path.endswith('.webmanifest'):
                    require(isinstance(json.loads(body), dict), 'PWA manifest is invalid')
                else:
                    require('javascript' in response.headers.get('Content-Type', '')
                            and not body.lstrip().lower().startswith(b'<!doctype'), 'PWA worker returned HTML or a wrong MIME type')
        return {'passed': True, 'paths': paths, 'images': session['identity']['images']}

    def prepare(self):
        self.stages.run('tool_tests', lambda: self.tool_tests())
        self.stages.run('snapshot', self.backup)
        self.stages.run('images', self.workspace_and_build)
        self.stages.run('infrastructure', self.infrastructure)
        self.stages.run('restore_and_migrate', self.restore_and_migrate)
        self.stages.run('application_tests', self.application_tests)
        self.stages.run('candidate_activation', self.activate)
        self.stages.run('public_assets', self.frontend_checks)
        self.tool('check')
        self.frontend_checks()
        print('CANDIDATE READY: ' + ORIGIN + '/tournaments/')
        print('MANIFEST LOCATION: ' + str(self.directory / 'client-location.json'))

    def tool_tests(self):
        self.run('tool-tests', ['python3', '-m', 'unittest', 'discover', '-s', self.workspace / 'docs/tournament-e2e', '-p', '*_test.py'])
        self.run('validation-tool-tests', ['python3', '-m', 'unittest', 'discover', '-s', self.workspace / 'docker', '-p', 'validation*_test.py'])
        return {'passed': True, 'application_tests': False}

    def finish(self):
        require(all(self.stages.report['stages'].get(name, {}).get('status') == 'passed' for name in
                    ('snapshot', 'images', 'restore_and_migrate', 'application_tests', 'candidate_activation', 'public_assets')),
                'Complete server preparation first')
        browser = read(self.directory / 'browser-result.json')
        session = read(self.state / 'session.json')
        self.tool('check')
        require(browser['targetSession'] == session['identity']['session_id'], 'Browser evidence is from another session')
        previous = self.stages.report.get('browser_evidence')
        if previous and previous.get('runId') != browser['runId']:
            require(self.stages.report['stages'].get('browser_acceptance', {}).get('status') != 'passed',
                    'A passed candidate run is immutable; do not replace it with another browser run')
            self.stages.report['stages'].pop('service_recovery', None)
            self.stages.report.pop('manual_acceptance', None)
        self.stages.report['browser_evidence'] = browser
        save(self.stages.file, self.stages.report)
        def browser_check():
            require(browser.get('browserPassed') is True and browser.get('performanceAcceptance', {}).get('passed') is True
                    and browser.get('serverVerification', {}).get('passed') is True and browser.get('passed') is True,
                    'Browser, performance or server database acceptance failed')
            return {'passed': True, 'run_id': browser['runId'], 'session_id': browser['targetSession']}
        self.stages.run('browser_acceptance', browser_check)
        self.stages.run('service_recovery', self.recovery)
        self.update_manual()

    def recovery(self):
        sys.path.insert(0, str(self.tools))
        import server_rehearsal as server
        args = SimpleNamespace(project=self.project, rehearsal=self.rehearsal)
        server.configure_target(args)
        session = server.verify_config(args, self.state)
        server.verify_live(session)
        db = Postgres(self.name)
        kinds = dict(session['identity']['database_context']['databases'],
                     analysis=session['identity']['integration_context']['analysis_database'])
        immutable = {}
        for kind, name in kinds.items():
            all_columns = db.fingerprint(name)['columns']
            tables = ('game_match', 'game_gameevent', 'game_gamestate', 'game_gameroom') if kind == 'game' else (
                     ('tournaments_wallettransaction', 'tournaments_participant') if kind == 'tournaments' else ('analysis_matchanalysis',))
            selected = {table: names for table, names in all_columns.items() if table in tables}
            require(set(selected) == set(tables), 'Missing recovery data tables')
            immutable[kind] = db.fingerprint(name, selected)
        # Check game/tournament restarts only; no analysis outage is introduced.
        restarted = ['game-api', 'tournaments-api', 'game-tasks', 'tournaments-tasks', 'push-worker']
        server.compose(args, self.state, 'restart', *restarted)
        server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
        server.refresh_nginx_candidate(self.state, session)
        self.install_listener(server, self.state / 'nginx.candidate.conf', {session['identity']['session_id']})
        server.verify_live(session)
        server.check_listener(session)
        for kind, name in kinds.items():
            require(db.fingerprint(name, immutable[kind]['columns']) == immutable[kind],
                    'Restart changed completed matches, events, balances or analysis rows')
        return {'passed': True, 'data_preserved_after_restart': True,
                'restarted_services': restarted, 'analysis_outage_test': 'excluded_by_user',
                'analysis_checked_by_tournament_audit': True}

    def update_manual(self):
        evidence = self.stages.report.setdefault('manual_acceptance', {})
        required = {key: {'status': 'pending', 'instruction': value} for key, value in MANUAL.items()}
        for key, value in required.items():
            evidence.setdefault(key, value)
        self.stages.report['automatic_checks_passed'] = all(self.stages.report['stages'].get(name, {}).get('status') == 'passed'
            for name in ('snapshot', 'images', 'restore_and_migrate', 'application_tests', 'candidate_activation',
                         'public_assets', 'browser_acceptance', 'service_recovery'))
        self.stages.report['passed'] = self.stages.report['automatic_checks_passed'] and all(
            evidence[key]['status'] == 'passed' for key in MANUAL)
        save(self.stages.file, self.stages.report)
        status = 'PASSED' if self.stages.report['passed'] else (
                 'MANUAL ACCEPTANCE PENDING' if self.stages.report['automatic_checks_passed'] else 'AUTOMATIC CHECKS INCOMPLETE')
        print('STAGES 1--4: ' + status)
        print('ONE REPORT: ' + str(self.stages.file))
        print('Production cutover was not performed.')

    def manual(self, check, evidence):
        require(self.stages.report['stages'].get('browser_acceptance', {}).get('status') == 'passed',
                'Manual acceptance must refer to the candidate completed browser run')
        require(check in MANUAL and evidence and len(evidence.strip()) >= 12, 'Provide the check and a concrete test observation')
        self.stages.report.setdefault('manual_acceptance', {})[check] = {
            'status': 'passed', 'instruction': MANUAL[check], 'evidence': evidence.strip(),
            'source': 'user_reported_observation', 'observed_at': timestamp(),
            'session_id': read(self.state / 'session.json')['identity']['session_id']}
        self.update_manual()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'finish', 'manual', 'status', 'restore-test'))
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--check', choices=tuple(MANUAL))
    parser.add_argument('--evidence')
    args = parser.parse_args()
    validation = Validation(args.root)
    import fcntl
    lock = (ROOT / 'reports/release-validation/operation.lock').open('a')
    os.chmod(lock.name, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ValueError('Another release validation server operation is running') from None
    if args.action == 'prepare':
        validation.prepare()
    elif args.action == 'finish':
        validation.finish()
    elif args.action == 'manual':
        validation.manual(args.check, args.evidence)
    elif args.action == 'restore-test':
        validation.restore_test()
    else:
        print(json.dumps(validation.stages.report, indent=2))


if __name__ == '__main__':
    main()
