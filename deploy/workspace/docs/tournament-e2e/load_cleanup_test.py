"""Safety checks with fake collectors/services; no database, SSH or Docker access."""
import json
from pathlib import Path
from types import SimpleNamespace
from types import ModuleType
import tempfile
import unittest
from unittest.mock import patch

from load_cleanup import safe_delete, validate_plan
from copied_load import finish_locked
from rehearsal_context import ORIGIN, require_browser_database_context, require_fresh_database_context


def copied_identity():
    return {'project': 'backgammon-candidate-' + 'b' * 32, 'validation_id': 'b' * 32,
        'infrastructure_revision': 'c' * 40, 'origin': ORIGIN, 'session_id': 'a' * 32,
        'tools_revision': 'd' * 40,
        'load_cleanup_version': 1, 'database_context': {'purpose': 'copied-browser-e2e',
            'databases': {kind: 'backgammon_' + kind for kind in ('game', 'tournaments', 'analysis')},
            'markers': {kind: None for kind in ('game', 'tournaments', 'analysis')},
            'redis_databases': {'game': 0, 'tournaments': 1}}}


class LoadIdentityTests(unittest.TestCase):
    def test_copied_opt_in_does_not_weaken_the_existing_fresh_guard(self):
        identity = copied_identity()
        self.assertEqual(require_browser_database_context(identity), identity['database_context'])
        with self.assertRaises(ValueError):
            require_fresh_database_context(identity)
        for key, value in [('load_cleanup_version', 0), ('project', 'backgammon-production'),
                           ('origin', ORIGIN.replace(':18443', '')), ('validation_id', 'd' * 32)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                require_browser_database_context(dict(identity, **{key: value}))

    def test_another_candidates_restoration_marker_is_refused(self):
        identity = copied_identity()
        context = identity['database_context']
        name = 'bgv_restore_' + 'b' * 12 + '_0_ab12cd'
        context['databases']['game'] = name
        context['markers']['game'] = 'backgammon-validation:' + 'b' * 32 + ':restore:' + name
        require_browser_database_context(identity)
        context['markers']['game'] = context['markers']['game'].replace('b' * 32, 'd' * 32)
        with self.assertRaises(ValueError):
            require_browser_database_context(identity)

    def test_exact_names_and_run_session_are_required(self):
        run = '20261007T120000000Z-ab12cd34'
        suffix = ''.join(value for value in run if value.isalnum())[-12:]
        plan = {'runId': run, 'targetSession': 'a' * 32, 'playerCount': 32,
                'usernames': [f'E2E{suffix}P{index + 1}' for index in range(32)],
                'tournamentName': 'Disposable E2E ' + suffix}
        validate_plan(plan, copied_identity())
        for change in [{'targetSession': 'd' * 32}, {'usernames': ['real-player']}, {'tournamentName': 'Existing'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_plan(dict(plan, **change), copied_identity())


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.baseline = {'models': {'example.item': ['7']}}
        self.queryset = SimpleNamespace(db='default')
        self.deleted = False

    def collector(self, rows=(), updates=(), fast=()):
        # Models/fields must be hashable, as Django's real Collector keys are.
        model = type('Model', (), {'_meta': SimpleNamespace(label_lower='example.item')})
        field = type('Field', (), {'model': model})()
        owner = self
        class Collector:
            def __init__(self, **_kwargs):
                self.data = {model: [SimpleNamespace(pk=value) for value in rows]}
                self.field_updates = {(field, None): [[SimpleNamespace(pk=value) for value in updates]]}
                self.fast_deletes = [SimpleNamespace(model=model, values_list=lambda *args, **kwargs: list(fast))] if fast else []
            def collect(self, _queryset):
                pass
            def delete(self):
                owner.deleted = True
                return len(rows), {'example.Item': len(rows)}
        return Collector

    def check(self, collector):
        modules = {name: ModuleType(name) for name in ('django', 'django.db', 'django.db.models', 'django.db.models.deletion')}
        modules['django.db.models.deletion'].Collector = collector
        with patch.dict('sys.modules', modules):
            counts = {}
            safe_delete(self.queryset, self.baseline, counts)
            return counts

    def test_preexisting_cascade_fast_delete_and_set_null_are_all_blocked(self):
        for args in [{'rows': [7]}, {'rows': [8], 'updates': [7]}, {'rows': [8], 'fast': [7]}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.check(self.collector(**args))
            self.assertFalse(self.deleted)

    def test_new_rows_and_repeated_empty_cleanup_are_allowed(self):
        self.assertEqual(self.check(self.collector(rows=[8])), {'example.Item': 1})
        self.assertEqual(self.check(self.collector()), {'example.Item': 0})


class CleanupRestorationTests(unittest.TestCase):
    def scenario(self, *, fail=False, interrupted=False, audit_fail=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        state = Path(temporary.name)
        (state / 'audit').mkdir()
        run = '20261007T120000000Z-ab12cd34'
        suffix = ''.join(value for value in run if value.isalnum())[-12:]
        plan = {'runId': run, 'targetSession': 'a' * 32, 'playerCount': 16,
            'usernames': [f'E2E{suffix}P{index + 1}' for index in range(16)], 'tournamentName': 'Disposable E2E ' + suffix}
        (state / 'audit/load-plan.json').write_text(json.dumps(plan))
        lock = state / 'load-run.lock'
        lock.write_text(json.dumps({'runId': run, 'targetSession': plan['targetSession']}))
        services = {'game-api': 'game', 'tournaments-api': 'tournaments', 'analysis-api': 'analysis', 'game-tasks': 'game'}
        statuses = {name: 'exited' if interrupted else 'running' for name in services}
        calls = []
        if interrupted:
            (state / ('load-' + run + '-writers.json')).write_text(json.dumps({
                'runId': run, 'targetSession': plan['targetSession'], 'running': list(services)}))
        def require(value, message):
            if not value:
                raise ValueError(message)
        def docker(action, *args):
            calls.append(action)
            if action in ('stop', 'start'):
                statuses.update({name: 'exited' if action == 'stop' else 'running' for name in services})
        def write(file, value):
            with file.open('x') as stream:
                json.dump(value, stream)
        def audit(*args):
            raise RuntimeError('Injected audit failure')
        server = SimpleNamespace(PROJECT='candidate', SERVICES=services, WORKERS=['game-tasks'], require=require,
            write=write, docker=docker, inspect=lambda name: {'project': 'candidate', 'service': name,
                'image': services[name], 'status': statuses[name]},
            wait_application_health=lambda *args, **kwargs: None,
            verify_live=lambda *args: None, check_listener=lambda *args: None,
            export_entry_report=lambda *args: None, collect_operations=lambda *args: state / 'operations.json',
            run_database_audits=audit,
            run=lambda args, **kwargs: Path(args[-1]).read_text())
        def app(_server, _args, _state, kind, action):
            calls.append((kind, action))
            if action == 'discover' and kind == 'tournaments':
                (state / 'audit' / ('load-' + run + '-tournaments-scope.json')).write_text(json.dumps({
                    'issuer': 'tournaments', 'externalIds': [], 'tournamentId': 9, 'fixtureIds': [1, 2]}))
            if action == 'cleanup':
                if fail and kind == 'game':
                    raise RuntimeError('Injected cleanup failure')
                (state / 'audit' / ('load-' + run + '-' + kind + '-cleanup.json')).write_text(json.dumps({
                    'runId': run, 'targetSession': plan['targetSession'], 'kind': kind, 'passed': True}))
        session = {'identity': {'session_id': plan['targetSession'], 'images': {kind: kind for kind in services.values()}}}
        args = SimpleNamespace(summary=None)
        if audit_fail:
            args.summary = state / 'browser-summary.json'
            args.summary.write_text(json.dumps({'runId': run, 'targetSession': plan['targetSession'], 'status': 'passed'}))
        with patch('copied_load.run_app', app):
            if fail or audit_fail:
                with self.assertRaises(ValueError):
                    finish_locked(server, args, state, session, cleanup_only=not audit_fail)
            else:
                finish_locked(server, args, state, session, cleanup_only=True)
        return calls, statuses, lock, json.loads((state / ('load-' + run + '-report.json')).read_text())

    def test_failed_delete_restores_services_and_retains_recovery_lock(self):
        calls, statuses, lock, report = self.scenario(fail=True)
        self.assertIn('start', calls)
        self.assertTrue(all(value == 'running' for value in statuses.values()))
        self.assertTrue(lock.exists())
        self.assertFalse(report['cleanup']['passed'])

    def test_retry_after_a_killed_process_restores_originally_running_services(self):
        calls, statuses, lock, report = self.scenario(interrupted=True)
        self.assertIn('start', calls)
        self.assertTrue(all(value == 'running' for value in statuses.values()))
        self.assertFalse(lock.exists())
        self.assertTrue(report['cleanup']['passed'])
        self.assertFalse(report['passed'])

    def test_an_audit_failure_still_cleans_and_preserves_the_failed_result(self):
        _, _, lock, report = self.scenario(audit_fail=True)
        self.assertTrue(report['cleanup']['passed'])
        self.assertFalse(report['serverVerification']['passed'])
        self.assertFalse(report['passed'])
        self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main()
