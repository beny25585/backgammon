"""Observer configuration tests using temporary files and mocked Docker only."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context
from server_rehearsal import configure_entry_observer, export_entry_report


class ObserverConfigurationTests(unittest.TestCase):
    def identity(self):
        return {'session_id': 'a' * 32, 'project': PROJECT, 'origin': ORIGIN,
                'database_context': fresh_database_context('a' * 32)}

    def test_only_api_overrides_change_and_configuration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'
            tools.mkdir()
            for name in ('rehearsal_entry.py', 'rehearsal_settings.py', 'rehearsal_asgi.py', 'rehearsal_context.py'):
                (tools / name).write_text('# observer\n')
            original = {'services': {kind: {'environment': {'DB_NAME': 'unchanged'}, 'volumes': [],
                                           'command': ['unchanged']}
                                     for kind in ('game-api', 'tournaments-api', 'game-tasks', 'tournaments-tasks', 'postgres')}}
            file = root / 'compose.e2e.json'
            file.write_text(json.dumps(original))
            configure_entry_observer(root, tools, self.identity())
            once = file.read_bytes()
            configure_entry_observer(root, tools, self.identity())
            self.assertEqual(file.read_bytes(), once)
            updated = json.loads(once)
            for kind in ('game-tasks', 'tournaments-tasks', 'postgres'):
                self.assertEqual(updated['services'][kind], original['services'][kind])
            for kind in ('game', 'tournaments'):
                api = updated['services'][kind + '-api']
                self.assertEqual(api['environment']['DB_NAME'], 'unchanged')
                self.assertEqual(api['environment']['E2E_ADMISSION_KIND'], kind)
                self.assertEqual(api['environment']['DJANGO_SETTINGS_MODULE'], 'rehearsal_settings')
                self.assertEqual(len(api['volumes']), 4)
                self.assertTrue(all(volume['read_only'] for volume in api['volumes']))

    def test_production_or_copied_context_is_refused_before_any_file_write(self):
        identity = copy.deepcopy(self.identity())
        identity['database_context']['databases']['game'] = 'backgammon_game'
        with self.assertRaises(ValueError):
            configure_entry_observer(Path('does-not-exist'), Path('does-not-exist'), identity)

    def test_export_collects_stderr_privately_and_filters_raw_logs(self):
        event = {'phase': 'presence_join_saved', 'serverAt': '2026-10-06T00:00:00+00:00',
                 'sessionId': 'a' * 32, 'service': 'tournaments', 'fixtureId': 2, 'seat': 'p1'}
        summary = {'runId': 'run_test_123', 'targetSession': 'a' * 32, 'tournamentId': 1,
                   'matches': [{'fixtureId': 2}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'audit').mkdir()
            def output(command, **kwargs):
                self.assertEqual(kwargs['stderr'], subprocess.STDOUT)
                self.assertEqual(kwargs['stdout'], subprocess.PIPE)
                text = 'GET /api/link/enter/?ticket=secret\n'
                if command[-1].endswith('tournaments-api-1'):
                    text += 'E2E_ADMISSION ' + json.dumps(event)
                return SimpleNamespace(stdout=text)
            with patch('server_rehearsal.subprocess.run', side_effect=output) as mocked, \
                    patch('server_rehearsal.postgres_query', return_value='[]') as query, patch('builtins.print'):
                export_entry_report(root, {'identity': self.identity()}, summary)
            self.assertEqual(mocked.call_count, 2)
            self.assertEqual(query.call_count, 1)
            self.assertEqual(query.call_args.args[0], 'backgammon_tournaments_e2e_' + 'a' * 12)
            self.assertTrue(query.call_args.args[1].startswith('SELECT '))
            report = (root / 'audit/entry-flow-run_test_123.json').read_text()
            self.assertNotIn('secret', report)
            self.assertEqual(json.loads(report)['coverage']['serverEvents'], 1)


if __name__ == '__main__':
    unittest.main()
