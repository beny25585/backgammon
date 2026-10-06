"""User-run checks of safety/resume semantics; no server, Docker or database access."""
import io
import itertools
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from validation_support import Postgres, Stages, declared_asset_sources, read, save
from validate_release import private_command


class CommandOutputTests(unittest.TestCase):
    def test_build_progress_reaches_console_before_child_exits_and_keeps_sudo_alive(self):
        with tempfile.TemporaryDirectory() as directory:
            acknowledgement = Path(directory, 'displayed')
            permission_refreshed = Path(directory, 'sudo-refreshed')
            log = Path(directory, 'build.private.log')

            class ConsoleBuffer(io.BytesIO):
                def write(self, value):
                    written = super().write(value)
                    if b'building layer\r' in self.getvalue():
                        acknowledgement.touch()
                    return written

            child = (
                "import sys, time\nfrom pathlib import Path\n"
                "sys.stdout.buffer.write(b'building layer\\r'); sys.stdout.buffer.flush()\n"
                "deadline = time.monotonic() + 5\n"
                "while not (Path(sys.argv[1]).exists() and Path(sys.argv[2]).exists()):\n"
                "    if time.monotonic() >= deadline: raise SystemExit(7)\n"
                "    time.sleep(0.01)\n"
                "sys.stderr.buffer.write(b'next layer\\n'); sys.stderr.buffer.flush()\n"
            )
            with io.TextIOWrapper(ConsoleBuffer(), encoding='utf-8') as console:
                with patch('validate_release.sys.stdout', console), \
                        patch('validate_release.time.monotonic', side_effect=itertools.count(0, 31)), \
                        patch('validate_release.subprocess.run',
                              side_effect=lambda *args, **kwargs: permission_refreshed.touch()) as keepalive:
                    private_command([sys.executable, '-u', '-c', child, acknowledgement, permission_refreshed], log,
                                    live_output=True)
                visible = console.buffer.getvalue()
            self.assertTrue(acknowledgement.is_file())
            self.assertIn(b'building layer\rnext layer\n', visible)
            self.assertNotIn(b'Still working', visible)
            self.assertEqual(log.read_bytes(), b'building layer\rnext layer\n')
            keepalive.assert_called_with(['sudo', '-n', '-v'],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.name != 'nt':
                self.assertEqual(log.stat().st_mode & 0o777, 0o600)

    def test_private_child_output_is_saved_without_being_displayed(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, 'private.log')
            with io.TextIOWrapper(io.BytesIO(), encoding='utf-8') as console:
                with patch('validate_release.sys.stdout', console), patch('validate_release.subprocess.run'):
                    private_command([sys.executable, '-c',
                                     "import sys; sys.stdout.buffer.write(b'private child output\\n')"], log)
                visible = console.buffer.getvalue()
            self.assertEqual(log.read_bytes(), b'private child output\n')
            self.assertNotIn(b'private child output', visible)

    def test_failed_build_displays_and_preserves_its_final_output(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, 'failed-build.private.log')
            with io.TextIOWrapper(io.BytesIO(), encoding='utf-8') as console:
                with patch('validate_release.sys.stdout', console), patch('validate_release.subprocess.run'):
                    with self.assertRaisesRegex(ValueError, 'Child command failed'):
                        private_command([sys.executable, '-c',
                                         "import sys; sys.stderr.buffer.write(b'failed layer\\n'); sys.exit(7)"],
                                        log, live_output=True)
                visible = console.buffer.getvalue()
            self.assertEqual(log.read_bytes(), b'failed layer\n')
            self.assertIn(b'failed layer\n', visible)


class ValidationSupportTests(unittest.TestCase):
    def test_declared_mounts_do_not_access_protected_host_paths(self):
        media = '/var/lib/docker/volumes/rehearsal_media/_data'
        secret = '/etc/backgammon-docker/game.json'
        session = '/home/administrator/backgammon-backups/browser-e2e-r2/session.json'
        mounts = [
            {'Destination': '/data/media', 'Source': media},
            {'Destination': '/srv/media', 'Source': media},
            {'Destination': '/run/secrets/game.json', 'Source': secret},
            {'Destination': '/opt/e2e/session.json', 'Source': session},
            {'Destination': '/var/lib/postgresql/data', 'Source': '/var/lib/docker/volumes/postgres/_data'},
        ]
        with patch('pathlib.Path.resolve', side_effect=PermissionError('Protected host path')):
            self.assertEqual(declared_asset_sources(mounts), {media, secret, session})

    def test_relative_or_parent_traversal_mount_sources_are_rejected(self):
        for source in ('relative/media', '/var/lib/docker/volumes/../other', None):
            with self.subTest(source=source), self.assertRaises(ValueError):
                declared_asset_sources([{'Destination': '/data/media', 'Source': source}])

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
