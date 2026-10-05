"""Opt-in queue/wallet tests on NEW PostgreSQL databases; no services or builds.

Run with the game's venv Python. Uses the existing local E2E cluster and its
restricted per-run roles. It never opens a work/production database, imports
application .env files, or starts workers that could send real notifications.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from zipfile import ZipFile

from e2e_common import RUNS_DIR, SERVICE_ROOTS, WORKSPACE, load_config, prepare_runtime, require, write_private

LABELS = {
    'game': ['game.tests.test_recurring_tasks', 'game.tests.test_task_ownership',
             'game.tests.test_action_latency', 'game.tests.test_connection_setup', 'game.tests.test_room_execution',
             'game.tests.test_expiry_ownership', 'game.link.test_postgresql_locking',
             'game.link.tests.EnqueueResultTests', 'game.link.tests.DeliveryRetryTests'],
    'tournament': ['frontend.test_tasks', 'frontend.test_task_ownership',
                   'frontend.test_search_lifecycle', 'frontend.test_entry_lifecycle',
                   'frontend.test_incident_recovery', 'frontend.test_tournament_lifecycle',
                   'tournaments.test_wallet_idempotency', 'tournaments.test_group_activation',
                   'gamelink.test_postgresql_locking', 'gamelink.tests.ResultCallbackViewTest'],
}


def run_service(run_dir, service):
    config = load_config(run_dir)
    require(config['database_mode'] == 'postgresql', 'these tests require PostgreSQL')
    marker = Path(run_dir) / 'reliability-only'
    require(marker.is_file() and marker.read_text(encoding='utf-8') == config['run_id'],
            'this is not a fresh queue/wallet validation run')
    prepare_runtime(run_dir, service)
    from postgresql_runtime import readonly
    with readonly(config, service) as db:
        existing = db.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'").fetchone()[0]
        require(existing == 0, 'refusing to run destructive tests on a nonempty database')
    # Fail closed on a second invocation, including a previous failed migration.
    write_private(Path(run_dir) / f'{service}-tests-started', 'started')
    from django.conf import settings
    settings.ALLOWED_HOSTS = ['testserver', '127.0.0.1', 'localhost']
    settings.CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
    settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
    import django
    django.setup()
    from django.core.management import call_command
    from django.db import connections
    from django.test.runner import DiscoverRunner

    class RunOwnedDatabaseRunner(DiscoverRunner):
        def setup_databases(self, **kwargs):
            # The administrator already provisioned a verified EMPTY run-owned
            # database. The app role cannot create/drop databases or connect to
            # any alternate database, including Django's usual postgres probe.
            call_command('migrate', interactive=False, verbosity=1)
            return []

        def teardown_databases(self, old_config, **kwargs):
            connections.close_all()

        def run_suite(self, suite, **kwargs):
            result = super().run_suite(suite, **kwargs)
            critical = ('game.tests.test_task_ownership.', 'frontend.test_task_ownership.Concurrent',
                        'tournaments.test_wallet_idempotency.Concurrent')
            require(not any(test.id().startswith(critical) for test, _ in result.skipped),
                    'PostgreSQL concurrency coverage was skipped')
            return result

    print(f'POSTGRESQL RELIABILITY: service={service}; isolated run-owned database; no services started', flush=True)
    failed = RunOwnedDatabaseRunner(verbosity=2, interactive=False).run_tests(LABELS[service])
    return int(bool(failed))


def resolve_python(service, value):
    if value:
        path = Path(value).resolve()
    elif service == 'game':
        path = Path(sys.executable).resolve()
    else:
        roots = (WORKSPACE / 'backgammon-tournaments-backend' / '.venv',
                 WORKSPACE / 'backgammon-tournaments-backend' / 'venv')
        paths = [root / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python') for root in roots]
        path = next((item for item in paths if item.is_file()), None)
    require(path is not None and path.is_file(), f'{service} venv Python was not found')
    return str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-python')
    parser.add_argument('--tournament-python')
    parser.add_argument('--run-dir', type=Path)
    parser.add_argument('--service', choices=tuple(LABELS))
    args = parser.parse_args()
    if args.service:
        require(args.run_dir is not None, 'child validation requires its run directory')
        return run_service(args.run_dir, args.service)
    require(args.run_dir is None, 'the runner chooses a fresh directory; existing runs cannot be reused')
    require(SERVICE_ROOTS == {
        'game': (WORKSPACE / 'Backgammon Game' / 'backend').resolve(),
        'tournament': (WORKSPACE / 'backgammon-tournaments-backend' / 'tournaments').resolve(),
    }, 'clear inherited E2E_GAME_ROOT/E2E_TOURNAMENT_ROOT; this runner checks current local source')
    interpreters = {service: resolve_python(service, getattr(args, f'{service}_python')) for service in LABELS}
    run = RUNS_DIR / ('reliability-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
    environment = os.environ.copy()
    for key in tuple(environment):
        if key.startswith('E2E_') and not key.startswith('E2E_PG_'):
            del environment[key]
    environment.update(E2E_DATABASE_MODE='postgresql', E2E_PROFILE='local',
                       E2E_GAME_ROOT=str(SERVICE_ROOTS['game']), E2E_TOURNAMENT_ROOT=str(SERVICE_ROOTS['tournament']))
    initialized = subprocess.run([interpreters['game'], str(Path(__file__).with_name('backend_bootstrap.py')),
                                  '--run-dir', str(run), 'init'], env=environment, check=False)
    if initialized.returncode:
        print(f'Provisioning failed; private artifacts if created: {run}', flush=True)
        return 1
    config = load_config(run)
    write_private(run / 'reliability-only', config['run_id'])
    report = run / 'share-report'
    report.mkdir()
    secrets = [value['PASSWORD'] for value in config['postgresql'].values()] + list(config['secrets'].values())
    checks = []
    for service in LABELS:
        print(f'START PostgreSQL {service} reliability checks', flush=True)
        log = report / f'{service}-checks.log'
        process = subprocess.Popen([interpreters[service], '-u', str(Path(__file__).resolve()),
                                    '--run-dir', str(run), '--service', service], env=environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   encoding='utf-8', errors='replace')
        try:
            with log.open('w', encoding='utf-8') as stream:
                for line in process.stdout:
                    for secret in secrets:
                        if secret:
                            line = line.replace(secret, '[REDACTED]')
                    line = re.sub(r'([?&](?:ticket|token)=)[^\s&\"\x27]+', r'\1[REDACTED]', line)
                    stream.write(line)
                    stream.flush()
                    print(line, end='', flush=True)
            code = process.wait()
        except BaseException:
            process.terminate()
            process.wait(timeout=10)
            raise
        checks.append({'service': service, 'exit_code': code, 'labels': LABELS[service], 'database': 'postgresql'})
    (report / 'summary.json').write_text(json.dumps({'checks': checks, 'services_started': False,
        'production_databases_opened': False, 'builds_run': False}, indent=2), encoding='utf-8')
    archive = Path(str(run) + '-report.zip')
    with ZipFile(archive, 'w') as bundle:
        for path in report.iterdir():
            bundle.write(path, arcname=path.name)
    print(f'SEND THIS FILE: {archive}', flush=True)
    return int(any(check['exit_code'] for check in checks))


if __name__ == '__main__':
    sys.exit(main())
