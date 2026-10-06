"""Observer configuration tests using temporary files and mocked Docker only."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context
from rehearsal_integrations import integration_context
from server_rehearsal import (configure_entry_observer, export_entry_report, select_services,
                             refresh_tools, harness_inventory, installed_tools_path, same_directory)


class ObserverConfigurationTests(unittest.TestCase):
    def identity(self):
        return {'session_id': 'a' * 32, 'project': PROJECT, 'origin': ORIGIN,
                'database_context': fresh_database_context('a' * 32)}

    def test_helper_mounts_refresh_and_observer_is_idempotent(self):
        self.addCleanup(select_services, self.identity())
        select_services(self.identity())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'
            tools.mkdir()
            for name in ('rehearsal_entry.py', 'rehearsal_settings.py', 'rehearsal_asgi.py', 'rehearsal_context.py', 'rehearsal_integrations.py', 'rehearsal_runtime.py'):
                (tools / name).write_text('# observer\n')
            original = {'services': {kind: {'environment': {'DB_NAME': 'unchanged'}, 'volumes': [],
                                           'command': ['unchanged']}
                                     for kind in ('game-api', 'tournaments-api', 'game-tasks', 'tournaments-tasks',
                                                  'game-migrate', 'tournaments-migrate', 'postgres')}}
            file = root / 'compose.e2e.json'
            file.write_text(json.dumps(original))
            configure_entry_observer(root, tools, self.identity())
            once = file.read_bytes()
            configure_entry_observer(root, tools, self.identity())
            self.assertEqual(file.read_bytes(), once)
            updated = json.loads(once)
            self.assertEqual(updated['services']['postgres'], original['services']['postgres'])
            for kind in ('game-tasks', 'tournaments-tasks', 'game-migrate', 'tournaments-migrate'):
                worker = updated['services'][kind]
                self.assertEqual(worker['environment'], original['services'][kind]['environment'])
                self.assertEqual(worker['command'], original['services'][kind]['command'])
                self.assertEqual({item['target'] for item in worker['volumes']},
                                 {'/opt/e2e/rehearsal_context.py', '/opt/e2e/rehearsal_integrations.py',
                                  '/opt/e2e/rehearsal_entry.py', '/opt/e2e/rehearsal_runtime.py'})
            for kind in ('game', 'tournaments'):
                api = updated['services'][kind + '-api']
                self.assertEqual(api['environment']['DB_NAME'], 'unchanged')
                self.assertEqual(api['environment']['E2E_ADMISSION_KIND'], kind)
                self.assertEqual(api['environment']['DJANGO_SETTINGS_MODULE'], 'rehearsal_settings')
                self.assertEqual(len(api['volumes']), 6)
                self.assertTrue(all(volume['read_only'] for volume in api['volumes']))

    def test_enabled_analysis_and_push_receive_all_runtime_helper_dependencies(self):
        identity = self.identity()
        identity['integrations'] = dict.fromkeys(('analysis', 'push', 'ai', 'google'), True)
        identity['database_context'] = fresh_database_context(identity['session_id'], integrations=True)
        identity['integration_context'] = integration_context(identity)
        self.addCleanup(select_services, self.identity())
        select_services(identity)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'
            tools.mkdir()
            for name in ('rehearsal_entry.py', 'rehearsal_settings.py', 'rehearsal_asgi.py',
                         'rehearsal_context.py', 'rehearsal_integrations.py', 'rehearsal_runtime.py'):
                (tools / name).write_text('# observer\n')
            services = ('game-api', 'tournaments-api', 'analysis-api', 'analysis-worker',
                        'analysis-migrate', 'push-worker')
            original = {'services': {name: {'environment': {'DB_NAME': 'unchanged'}, 'volumes': [],
                                           'command': ['unchanged']} for name in services}}
            file = root / 'compose.e2e.json'
            file.write_text(json.dumps(original))
            configure_entry_observer(root, tools, identity)
            once = file.read_bytes()
            configure_entry_observer(root, tools, identity)
            self.assertEqual(file.read_bytes(), once)
            updated = json.loads(once)
            for name in ('analysis-api', 'analysis-worker', 'analysis-migrate', 'push-worker'):
                with self.subTest(service=name):
                    service = updated['services'][name]
                    self.assertEqual(service['environment'], original['services'][name]['environment'])
                    self.assertEqual(service['command'], original['services'][name]['command'])
                    self.assertEqual({volume['target'] for volume in service['volumes']}, {
                        '/opt/e2e/rehearsal_context.py', '/opt/e2e/rehearsal_integrations.py',
                        '/opt/e2e/rehearsal_entry.py', '/opt/e2e/rehearsal_runtime.py'})
                    self.assertTrue(all(volume['read_only'] for volume in service['volumes']))

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


class ServerLayoutTests(unittest.TestCase):
    def test_directory_identity_accepts_aliases_but_rejects_other_or_missing_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'project'
            current.mkdir()
            other = root / 'other'
            other.mkdir()
            self.assertTrue(same_directory(current, other / '..' / 'project'))
            self.assertFalse(same_directory(current, other))
            self.assertFalse(same_directory(current, root / 'missing'))
            self.assertFalse(same_directory(root / 'missing', root / 'missing'))

    def test_compatibility_link_must_point_to_the_same_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'backgammon-project'
            state = root / 'backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal/browser-e2e-r2'
            state.mkdir(parents=True)
            source = root / 'sources/backgammon/deploy/workspace/docs/tournament-e2e'
            source.mkdir(parents=True)
            current = root / 'tools/backgammon-e2e-tools-test'
            current.mkdir(parents=True)
            alias = Path(directory) / 'legacy'
            try:
                alias.symlink_to(current, target_is_directory=True)
            except OSError as exc:
                self.skipTest('Directory symlinks unavailable: ' + str(exc))
            self.assertTrue(same_directory(alias, current))
            self.assertEqual(installed_tools_path(alias, state, source), current.resolve())
            other = root / 'other'
            other.mkdir()
            self.assertFalse(same_directory(alias, other))

    def test_managed_installation_accepts_the_tools_directory_and_rejects_other_locations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'backgammon-project'
            state = root / 'backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal/browser-e2e-r2'
            state.mkdir(parents=True)
            source = root / 'sources/backgammon/deploy/workspace/docs/tournament-e2e'
            source.mkdir(parents=True)
            active = root / 'tools/backgammon-e2e-tools-test'
            active.mkdir(parents=True)
            self.assertEqual(installed_tools_path(active, state, source), active.resolve())
            wrong_parent = root / 'archives/backgammon-e2e-tools-test'
            wrong_parent.mkdir(parents=True)
            wrong_name = active.parent / 'unrelated-tools'
            wrong_name.mkdir()
            for invalid in (wrong_parent, wrong_name, source):
                with self.subTest(active=invalid), self.assertRaises(ValueError):
                    installed_tools_path(invalid, state, source)
            with self.assertRaises(ValueError):
                installed_tools_path(active, state, active)


class ToolUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.state = self.home / 'backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal/browser-e2e-r2'
        (self.state / 'audit').mkdir(parents=True)
        self.source = self.home / 'source/deploy/workspace/docs/tournament-e2e'
        self.source.mkdir(parents=True)
        self.active = self.home / 'backgammon-e2e-tools-test'
        self.active.mkdir()
        for name in ('server_rehearsal.py', 'source-versions.mjs'):
            (self.active / name).write_text('old\n')
            (self.source / name).write_text('new\n')
        names, digest = harness_inventory(self.active)
        self.session = {'tools_dir': str(self.active), 'harness_files': names,
                        'identity': {'session_id': 'a' * 32, 'harness_sha256': digest}, 'admin': {'private': 'test'}}
        self.client = {'identity': self.session['identity'], 'admin': self.session['admin'], 'harness_files': names}
        for name, value in (('session.json', self.session), ('identity.json', self.session['identity']),
                            ('server-client.json', self.client)):
            (self.state / name).write_text(json.dumps(value))
        for name in ('SHA256SUMS', 'bundle-info.json'):
            (self.active / name).write_text('old metadata\n')
        for name in ('baseline-game.json', 'baseline-tournaments.json', 'operations-baseline.json'):
            (self.state / 'audit' / name).write_text('preserved baseline\n')
        self.public = self.home / 'public' / ('a' * 32) / 'identity.json'
        self.public.parent.mkdir(parents=True)
        self.public.write_text(json.dumps(self.session['identity']))
        self.revision = 'b' * 40
        self.args = SimpleNamespace(tools_revision=self.revision)
        self.dirty = False

    def external_run(self, command, **kwargs):
        if command[0] == 'git':
            if command[3] == 'rev-parse':
                return self.revision
            if command[3] == 'status':
                return ' M backend/game/models.py' if self.dirty else ''
            if command[3] == 'ls-files':
                return '\n'.join('deploy/workspace/docs/tournament-e2e/' + name for name in self.session['harness_files'])
        if command[:2] == ['sudo', 'sha256sum']:
            return '\n'.join(hashlib.sha256(file.read_bytes()).hexdigest() for file in command[2:])
        if command[:2] == ['sudo', 'install']:
            shutil.copyfile(command[-2], command[-1])
            return None
        raise AssertionError('Unexpected external operation: ' + str(command))

    def execute(self, live):
        def path(value):
            return self.home / 'public' if value == '/var/lib/backgammon-e2e' else Path(value)
        with patch('server_rehearsal.run', side_effect=self.external_run), patch('server_rehearsal.Path', side_effect=path), \
                patch('server_rehearsal.verify_live', side_effect=live), patch('server_rehearsal.check_listener'), \
                patch('builtins.print'):
            refresh_tools(self.args, self.state, self.source, self.session)

    def test_update_preserves_mount_inodes_and_baselines(self):
        inode = (self.active / 'server_rehearsal.py').stat().st_ino
        self.execute(lambda session: None)
        self.assertEqual((self.active / 'server_rehearsal.py').stat().st_ino, inode)
        updated = json.loads((self.state / 'session.json').read_text())
        self.assertEqual(updated['identity']['harness_sha256'], harness_inventory(self.source)[1])
        self.assertEqual(updated['identity'], json.loads(self.public.read_text()))
        self.assertEqual(updated['tools_dir'], self.session['tools_dir'])
        self.assertEqual((self.state / 'audit/baseline-game.json').read_text(), 'preserved baseline\n')
        self.assertTrue((self.state / 'tool-updates' / self.revision / 'files.json').exists())

    def test_dirty_git_source_is_rejected_before_any_update(self):
        self.dirty = True
        with self.assertRaisesRegex(ValueError, 'clean approved Git commit'):
            self.execute(lambda session: None)
        self.assertEqual((self.active / 'server_rehearsal.py').read_text(), 'old\n')
        self.assertFalse((self.state / 'tool-updates').exists())

    def test_failed_verification_restores_original_files_and_public_identity(self):
        def live(session):
            if session['identity']['harness_sha256'] != self.session['identity']['harness_sha256']:
                raise ValueError('Post-update health failed')
        with self.assertRaisesRegex(ValueError, 'Post-update health failed'):
            self.execute(live)
        self.assertEqual((self.active / 'server_rehearsal.py').read_text(), 'old\n')
        self.assertEqual(json.loads(self.public.read_text()), self.session['identity'])
        self.assertEqual(json.loads((self.state / 'session.json').read_text()), self.session)
        self.execute(lambda session: None)
        self.assertEqual((self.active / 'server_rehearsal.py').read_text(), 'new\n')


if __name__ == '__main__':
    unittest.main()
