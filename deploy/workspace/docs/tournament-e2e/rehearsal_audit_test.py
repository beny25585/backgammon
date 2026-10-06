"""Pure audit policy tests; no Django, Docker, database, service or network access."""
from types import SimpleNamespace
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from rehearsal_app import (audit_outcome, task_audit_fields, task_failures, task_status,
                           safe_error, require_analysis_configuration, require_tournament_finished,
                           require_tournament_podium)
from rehearsal_integrations import ANALYSIS_URL
from server_rehearsal import run_database_audits


class RehearsalAuditTests(unittest.TestCase):
    def test_tournaments_analysis_uses_runtime_environment_when_settings_are_missing_or_empty(self):
        environment = {'ANALYSIS_SERVICE_URL': ANALYSIS_URL, 'ANALYSIS_API_TOKEN': 'test-token'}
        for settings in (SimpleNamespace(), SimpleNamespace(ANALYSIS_SERVICE_URL='', ANALYSIS_API_TOKEN='')):
            with self.subTest(settings=settings):
                require_analysis_configuration(settings, environment, 'tournaments', enabled=True)

    def test_game_analysis_requires_its_actual_analysis_and_ai_urls(self):
        settings = SimpleNamespace(ANALYSIS_SERVICE_URL=ANALYSIS_URL, AI_SERVICE_URL=ANALYSIS_URL)
        environment = {'ANALYSIS_SERVICE_URL': ANALYSIS_URL, 'AI_SERVICE_URL': ANALYSIS_URL,
                       'ANALYSIS_API_TOKEN': 'test-token'}
        require_analysis_configuration(settings, environment, 'game', enabled=True)
        settings.AI_SERVICE_URL = 'http://outside.invalid'
        with self.assertRaisesRegex(ValueError, 'AI must use'):
            require_analysis_configuration(settings, environment, 'game', enabled=True)

    def test_analysis_setting_cannot_redirect_a_safe_environment_to_another_service(self):
        settings = SimpleNamespace(ANALYSIS_SERVICE_URL='http://outside.invalid')
        environment = {'ANALYSIS_SERVICE_URL': ANALYSIS_URL, 'ANALYSIS_API_TOKEN': 'test-token'}
        with self.assertRaisesRegex(ValueError, 'isolated internal service'):
            require_analysis_configuration(settings, environment, 'tournaments', enabled=True)

    def test_analysis_requires_internal_environment_and_a_token(self):
        settings = SimpleNamespace(ANALYSIS_SERVICE_URL=ANALYSIS_URL)
        for environment in ({'ANALYSIS_SERVICE_URL': 'http://outside.invalid', 'ANALYSIS_API_TOKEN': 'test-token'},
                            {'ANALYSIS_SERVICE_URL': ANALYSIS_URL, 'ANALYSIS_API_TOKEN': ''}):
            with self.subTest(environment=environment), self.assertRaises(ValueError):
                require_analysis_configuration(settings, environment, 'tournaments', enabled=True)

    def test_disabled_analysis_cannot_be_activated_by_settings_or_environment(self):
        require_analysis_configuration(SimpleNamespace(), {'ANALYSIS_SERVICE_URL': ''}, 'tournaments', enabled=False)
        for settings, environment in ((SimpleNamespace(ANALYSIS_SERVICE_URL=ANALYSIS_URL), {'ANALYSIS_SERVICE_URL': ''}),
                                      (SimpleNamespace(), {'ANALYSIS_SERVICE_URL': ANALYSIS_URL})):
            with self.subTest(settings=settings, environment=environment), self.assertRaises(ValueError):
                require_analysis_configuration(settings, environment, 'tournaments', enabled=False)

    def tournament(self, **changes):
        values = {'name': 'Browser tournament', 'state': 'finished',
                  'entry_deadline_paused': False, 'results_confirmed_at': None}
        return SimpleNamespace(**dict(values, **changes))

    def participant(self, participant_id, position):
        return SimpleNamespace(participant_id=participant_id, podium_position=position)

    def test_automatic_finish_does_not_require_historical_organizer_approval(self):
        require_tournament_finished(self.tournament(), 'Browser tournament')

    def test_historical_approval_is_compatible_with_actual_finish(self):
        require_tournament_finished(self.tournament(results_confirmed_at='historical approval'),
                                    'Browser tournament')

    def test_approval_cannot_make_an_unfinished_tournament_pass(self):
        for state in ('draft', 'open', 'active'):
            with self.subTest(state=state), self.assertRaises(ValueError):
                require_tournament_finished(self.tournament(state=state, results_confirmed_at='approval'),
                                            'Browser tournament')

    def test_paused_tournament_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'did not finish normally'):
            require_tournament_finished(self.tournament(entry_deadline_paused=True), 'Browser tournament')

    def test_another_tournament_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'name differs'):
            require_tournament_finished(self.tournament(name='Another tournament'), 'Browser tournament')

    def test_zero_position_champion_is_preserved_and_unplaced_players_are_excluded(self):
        champion = self.participant(41, 0)
        participants = [self.participant(43, None), self.participant(42, 1), champion]
        self.assertIs(require_tournament_podium(participants, [{'id': 41}, {'id': 42}]), champion)

    def test_one_based_podium_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected podium'):
            require_tournament_podium([self.participant(41, 1), self.participant(42, 2)],
                                      [{'id': 41}, {'id': 42}])

    def test_missing_duplicate_or_extra_podium_positions_are_rejected(self):
        for positions in ([], [0], [1], [0, 0], [0, 1, 2]):
            participants = [self.participant(41 + index, position) for index, position in enumerate(positions)]
            with self.subTest(positions=positions), self.assertRaisesRegex(ValueError, 'Unexpected podium'):
                require_tournament_podium(participants, [{'id': 41}, {'id': 42}])

    def test_both_podium_members_and_their_order_must_match_the_browser(self):
        participants = [self.participant(41, 0), self.participant(42, 1)]
        for observed in ([{'id': 42}, {'id': 41}], [{'id': 41}, {'id': 99}], [], [{'id': 41}]):
            with self.subTest(observed=observed), self.assertRaisesRegex(ValueError, 'podium differs'):
                require_tournament_podium(participants, observed)

    def task(self, **changes):
        values = dict(pk='task-1', name='scheduled-task', status='failed', attempts=2,
            last_error='events=209 room_sequence=210', created_at='created', updated_at='updated',
            run_at='scheduled')
        return SimpleNamespace(**dict(values, **changes))

    def test_tournament_task_does_not_require_game_only_fields(self):
        self.assertNotIn('max_attempts', task_audit_fields('tournaments'))
        self.assertNotIn('kwargs', task_audit_fields('tournaments'))
        self.assertIn('max_attempts', task_audit_fields('game'))
        failure = task_failures([self.task()], {})[0]
        self.assertIsNone(failure['max_attempts'])
        self.assertTrue(failure['changed_since_baseline'])

    def test_unchanged_baseline_failure_is_reported_without_being_a_new_failure(self):
        task = self.task()
        failure = task_failures([task], {str(task.pk): task_status(task)})[0]
        self.assertFalse(failure['changed_since_baseline'])
        task.attempts += 1
        self.assertTrue(task_failures([task], {str(task.pk): failure['before']})[0]['changed_since_baseline'])

    def test_pending_retry_error_is_reported_but_clean_periodic_task_is_not(self):
        failed = self.task(status='pending')
        clean = self.task(status='pending', last_error='')
        self.assertEqual(len(task_failures([failed, clean], {})), 1)

    def test_error_preserves_event_counts_without_credentials(self):
        value = safe_error('events=209 room_sequence=210 token=private-value '
                           'Bearer bearer-value email@example.invalid https://private.invalid/?ticket=private')
        self.assertIn('events=209 room_sequence=210', value)
        for secret in ('private-value', 'bearer-value', 'email@example.invalid', 'private.invalid'):
            self.assertNotIn(secret, value)

    def test_failed_audit_saves_diagnostics_and_rethrows_original_failure(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            file = Path(directory) / 'audit.json'
            report = {'stage': 'background_tasks', 'task_failure_details': [{'name': 'analysis'}]}
            with self.assertRaisesRegex(ValueError, 'Failed worker'):
                with audit_outcome(file, report):
                    report['results_verified'] = True
                    raise ValueError('Failed worker token=private-value')
            saved = json.loads(file.read_text())
            self.assertFalse(saved['passed'])
            self.assertTrue(saved['results_verified'])
            self.assertEqual(saved['stage'], 'background_tasks')
            self.assertEqual(saved['task_failure_details'], [{'name': 'analysis'}])
            self.assertNotIn('private-value', saved['failure']['message'])

    def test_success_is_marked_only_after_the_entire_audit_finishes(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            file = Path(directory) / 'audit.json'
            with audit_outcome(file, {}):
                self.assertFalse(json.loads(file.read_text())['passed'])
            self.assertTrue(json.loads(file.read_text())['passed'])
            self.assertEqual(json.loads(file.read_text())['stage'], 'complete')


class CombinedAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.state = Path(self.temporary.name)
        (self.state / 'audit').mkdir()
        self.operations = self.state / 'audit/operations.json'
        self.operations.write_text('{}')
        self.session = {'identity': {'session_id': 'a' * 32}}
        self.summary = {'runId': '20261006-run'}
        self.calls = []

    def app(self, args, state, kind, action, failed=False):
        self.calls.append((kind, action))
        file = state / 'audit' / (self.summary['runId'] + '-' + kind + '-' + action + '.json')
        file.write_text(json.dumps({'passed': not failed, 'kind': kind, 'run_id': self.summary['runId'],
            'session_id': self.session['identity']['session_id'], 'results_verified': True, 'audit_id': len(self.calls)}))
        if failed:
            raise subprocess.CalledProcessError(1, ['audit'])

    def execute(self, app):
        with patch('server_rehearsal.app', side_effect=app), \
                patch('server_rehearsal.require_integration_context', return_value=None), \
                patch('server_rehearsal.run', side_effect=lambda command, **kwargs: Path(command[-1]).read_text()), \
                redirect_stdout(io.StringIO()):
            run_database_audits(None, self.state, self.session, self.summary, self.operations)

    def test_game_failure_does_not_hide_wallet_audit_and_replay_is_skipped(self):
        with self.assertRaisesRegex(ValueError, 'Server audit failed'):
            self.execute(lambda args, state, kind, action: self.app(args, state, kind, action, failed=kind == 'game'))
        saved = json.loads(self.operations.read_text())
        self.assertEqual(self.calls, [('game', 'audit'), ('tournaments', 'audit')])
        self.assertFalse(saved['database_audits_passed'])
        self.assertTrue(saved['audit_steps']['game']['report']['results_verified'])
        self.assertEqual(saved['audit_steps']['tournaments']['status'], 'passed')
        self.assertEqual(saved['audit_steps']['duplicate_results']['status'], 'skipped')

    def test_success_requires_duplicate_replay_and_wallet_recheck(self):
        self.execute(self.app)
        self.assertEqual(self.calls, [('game', 'audit'), ('tournaments', 'audit'),
                                     ('game', 'replay'), ('tournaments', 'audit')])
        self.assertTrue(json.loads(self.operations.read_text())['database_audits_passed'])

    def test_old_report_cannot_make_a_failed_invocation_pass(self):
        self.app(None, self.state, 'game', 'audit')
        self.calls.clear()
        def operation(args, state, kind, action):
            if kind == 'game':
                raise subprocess.CalledProcessError(1, ['audit'])
            return self.app(args, state, kind, action)
        with self.assertRaises(ValueError):
            self.execute(operation)
        saved = json.loads(self.operations.read_text())
        self.assertEqual(saved['audit_steps']['game']['status'], 'failed')
        self.assertNotIn('report', saved['audit_steps']['game'])


if __name__ == '__main__':
    unittest.main()
