"""User-run checks of safety/resume semantics; no server, Docker or database access."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock

from validation_support import Postgres, Stages, read, save


class ValidationSupportTests(unittest.TestCase):
    def test_failed_stage_is_preserved_then_retried_without_repeating_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            stages = Stages(directory, {'revision': 'a' * 40})
            failed = Mock(side_effect=ValueError('private diagnosis'))
            with self.assertRaises(ValueError):
                stages.run('restore', failed)
            saved = read(stages.file)
            self.assertEqual(saved['stages']['restore']['status'], 'failed')
            self.assertNotIn('private diagnosis', stages.file.read_text())
            self.assertFalse(saved['passed'])
            resumed = Stages(directory, {'revision': 'a' * 40})
            success = Mock(return_value={'verified': True})
            resumed.run('restore', success)
            resumed.run('restore', success)
            success.assert_called_once()
            self.assertEqual(resumed.report['stages']['restore']['attempt'], 2)
            with self.assertRaises(ValueError):
                Stages(directory, {'revision': 'b' * 40})

    def test_existing_or_nonvalidation_database_cannot_be_overwritten(self):
        database = object.__new__(Postgres)
        database.sql = Mock(return_value='1')
        for name in ('backgammon_game', 'bgv_restore_' + 'a' * 12 + '_example'):
            marker = 'backgammon-validation:' + 'a' * 32 + ':restore:' + name
            with self.subTest(name=name), self.assertRaises(ValueError):
                database.create(name, 'backgammon_game', marker)
        self.assertEqual(database.sql.call_count, 1)
        self.assertTrue(database.sql.call_args.args[1].startswith('SELECT 1'))

    def test_saved_artifact_replaces_atomically_despite_a_stale_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory, 'state.json')
            file.with_name('state.json.tmp').write_text('interrupted')
            save(file, {'phase': 1})
            save(file, {'phase': 2})
            self.assertEqual(read(file), {'phase': 2})


if __name__ == '__main__':
    unittest.main()
