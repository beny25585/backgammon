"""Container checks on marked restoration/test databases, or the fresh candidate session."""
import json
import os
from pathlib import Path
import re
import sys

GAME_LABELS = [
    'game.tests.analysis', 'game.tests.gameplay.test_event_history',
    'game.tests.gameplay.test_game_event_scoping', 'game.tests.gameplay.test_series_endings',
    'game.tests.test_action_latency', 'game.tests.test_task_ownership',
    'game.tests.test_legacy.GameConsumerTests.test_move_broadcast_follows_committed_state_and_history',
    'game.tests.test_legacy.FinalizeRoomTests', 'game.tests.test_legacy.MatchContinuationTests',
]
TOURNAMENT_LABELS = [
    'frontend.test_tasks', 'frontend.test_task_ownership', 'frontend.test_entry_lifecycle',
    'frontend.test_search_lifecycle', 'frontend.test_match_administration',
    'frontend.test_control_room', 'frontend.test_incident_recovery',
    'tournaments.test_wallet_idempotency', 'gamelink.test_practice',
    'gamelink.test_entry_admission', 'gamelink.test_event_entry', 'gamelink.test_postgresql_locking',
]


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    action, job_file = sys.argv[1:]
    job = json.loads(Path(job_file).read_text())
    require(re.fullmatch(r'[a-f0-9]{32}', job['validation_id']), 'An explicit validation ID is required')
    sys.path.insert(0, os.getcwd())
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection
    from django.core.management import call_command
    require(connection.vendor == 'postgresql' and connection.settings_dict['HOST'] == 'postgres',
            'Checks require the isolated candidate PostgreSQL service')
    kind = job['kind']
    require(kind in ('game', 'tournaments', 'analysis'), 'Unexpected validation service')
    require(connection.settings_dict['USER'] == 'backgammon_' + kind, 'Unexpected validation role')
    match = re.fullmatch(r'bgv_(restore|test)_([a-f0-9]{12})_[a-z0-9_]{1,22}', job['database'])
    require(match and match[2] == job['validation_id'][:12]
            and job['marker'] == f"backgammon-validation:{job['validation_id']}:{match[1]}:{job['database']}"
            and connection.settings_dict['NAME'] == job['database'], 'Refusing a work or another validation database')
    with connection.cursor() as cursor:
        cursor.execute("SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()")
        require(cursor.fetchone()[0] == job['marker'], 'Validation database marker differs')
    settings.EMAIL_BACKEND = 'django.core.mail.backends.dummy.EmailBackend'
    settings.ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
    settings.CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
    settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
    settings.GAMELINK_ENABLED = False
    settings.WEB_PUSH_PRIVATE_KEY = ''
    if action == 'migrate':
        call_command('migrate', interactive=False, verbosity=1)
        call_command('migrate', check=True, interactive=False, verbosity=0)
        call_command('makemigrations', check=True, dry_run=True, interactive=False, verbosity=1)
        result = {'passed': True, 'database': job['database'], 'kind': kind}
        if kind == 'game':
            from game.models import GameRoom, Match, Task
            result.update(legacy_rooms=GameRoom.objects.filter(history_sequence=None).count(),
                open_rooms=GameRoom.objects.exclude(status__in=['completed', 'cancelled']).count(),
                legacy_matches=Match.objects.filter(history_sequence=None).count(),
                failed_analysis_tasks=list(Task.objects.filter(
                    name__in=['game.analysis.outbox.deliver_analysis', 'game.analysis_outbox.deliver_analysis'],
                    status__in=['failed', 'blocked']).values('id', 'name', 'status')))
    else:
        require(action == 'tests' and kind in ('game', 'tournaments'), 'Unknown validation action')
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
            require(cursor.fetchone()[0] == 0, 'Tests must start in a new EMPTY validation database')
        from django.test.runner import DiscoverRunner

        class OwnedDatabaseRunner(DiscoverRunner):
            def setup_databases(self, **kwargs):
                call_command('migrate', interactive=False, verbosity=1)
                call_command('makemigrations', check=True, dry_run=True, interactive=False, verbosity=1)
                return []

            def teardown_databases(self, old_config, **kwargs):
                from django.db import connections
                connections.close_all()

            def run_suite(self, suite, **kwargs):
                outcome = super().run_suite(suite, **kwargs)
                self.outcome = outcome
                critical = ('game.tests.analysis.', 'game.tests.gameplay.test_event_history.',
                            'game.tests.test_task_ownership.', 'gamelink.test_postgresql_locking.',
                            'tournaments.test_wallet_idempotency.Concurrent', 'frontend.test_task_ownership.Concurrent')
                require(not any(test.id().startswith(critical) for test, _ in outcome.skipped),
                        'A required PostgreSQL/analysis check was skipped')
                return outcome

        labels = GAME_LABELS if kind == 'game' else TOURNAMENT_LABELS
        runner = OwnedDatabaseRunner(verbosity=2, interactive=False)
        failed = runner.run_tests(labels)
        result = {'passed': failed == 0, 'kind': kind, 'database': job['database'], 'labels': labels,
                  'tests_run': runner.outcome.testsRun, 'skipped': len(runner.outcome.skipped),
                  'failures': len(runner.outcome.failures), 'errors': len(runner.outcome.errors)}
    Path('/data/validation/result.json').write_text(json.dumps(result, indent=2, default=str))
    require(result['passed'], 'Candidate checks failed; preserve the report and private test log')


if __name__ == '__main__':
    main()
