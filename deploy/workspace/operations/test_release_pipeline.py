"""Release safety checks with fake services; no application tests or real publication."""
import contextlib
import copy
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_pipeline as release


def manifest():
    return {'schema_version': 1, 'release_id': 'bg-release-20261008t120000z-1234abcd', 'sources': {
        name: {'revision': 'a' * 40, 'branch': branch, 'url': 'https://github.com/' + origin + '.git'}
        for name, (branch, origin, _) in release.SOURCES.items()
    }}


class ManifestTests(unittest.TestCase):
    def test_all_four_sources_required(self):
        value = manifest()
        release.validate_manifest(value)
        del value['sources']['Backgammon Game']
        with self.assertRaisesRegex(RuntimeError, 'source set'):
            release.validate_manifest(value)

    def test_wrong_branch_and_revision_rejected(self):
        for field, value in (('branch', 'main'), ('revision', 'HEAD'), ('url', 'https://evil.example/code.git')):
            data = manifest()
            data['sources']['Backgammon Game'][field] = value
            with self.assertRaises(RuntimeError):
                release.validate_manifest(data)

    def test_unsafe_release_directory_rejected(self):
        data = manifest()
        data['release_id'] = '../../production'
        with self.assertRaises(RuntimeError):
            release.validate_manifest(data)

    def test_github_https_ssh_and_credentials(self):
        for url in ('https://github.com/Owner/Repo.git', 'git@github.com:Owner/Repo.git', 'ssh://git@github.com/Owner/Repo.git'):
            self.assertEqual(release.github_repository(url), 'owner/repo')
        with self.assertRaises(RuntimeError):
            release.github_repository('https://secret@github.com/Owner/Repo.git')


class ResumeTests(unittest.TestCase):
    def fixture(self, root):
        previous = manifest()
        directory = root / 'artifacts/auto-releases' / previous['release_id']
        directory.mkdir(parents=True)
        status = dict(previous, stage='failed', failed_stage='game-migrations', published={},
                      error='game-migrations failed (exit 1). Log: ' + str(directory / '021-game-migrations.log'))
        release.save(directory / 'status.json', status)
        for index, stage in enumerate(release.RESUME_COMPLETED_STAGES, 1):
            text = 'completed\n'
            if stage.startswith('build-'):
                text = ('exporting config sha256:' + 'b' * 64 + '\n'
                        'exporting manifest list sha256:' + 'c' * 64 + '\n')
            (directory / f'{index:03d}-{stage}.log').write_text(text)
        (directory / '021-game-migrations.log').write_text('corsheaders.E013')
        return directory, status

    def image(self, kind, previous, digest='c'):
        source = release.IMAGES[kind][0]
        return {'Id': 'sha256:' + digest * 64, 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {
            'org.opencontainers.image.revision': previous['sources'][source]['revision'],
            'io.backgammon.release': previous['release_id'],
        }}}

    def fake_capture(self, previous, digest='c'):
        def inspect(args):
            kind = str(args[-1]).split(':')[0].removeprefix('backgammon-production-')
            return json.dumps([self.image(kind, previous, digest)]).encode()
        return inspect

    def test_tool_only_commit_reuses_pinned_images_and_records_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory, previous = self.fixture(root)
            current = copy.deepcopy(previous['sources'])
            current['Backgammon Game']['revision'] = 'd' * 40
            def changes(repository, *args):
                return 'deploy/workspace/operations/release_test_settings.py\0' if repository.name == 'Backgammon Game' else ''
            before = (directory / 'status.json').read_bytes()
            with patch.object(release, 'git', side_effect=changes), \
                 patch.object(release, 'capture', side_effect=self.fake_capture(previous)):
                images, evidence = release.resume_checks(root, previous['release_id'], current)
            self.assertEqual(set(images), set(release.IMAGES))
            self.assertEqual(len(evidence['completed_log_sha256']), 20)
            self.assertEqual(evidence['sources'], previous['sources'])
            self.assertEqual(evidence['tool_changes']['Backgammon Game'],
                             ['deploy/workspace/operations/release_test_settings.py'])
            self.assertEqual((directory / 'status.json').read_bytes(), before)

    def test_classic_docker_config_digest_also_supported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, previous = self.fixture(root)
            with patch.object(release, 'git', return_value=''), \
                 patch.object(release, 'capture', side_effect=self.fake_capture(previous, 'b')):
                images, _ = release.resume_checks(root, previous['release_id'], previous['sources'])
            self.assertEqual(images['game'], 'sha256:' + 'b' * 64)

    def test_application_docker_and_other_repository_changes_refused_before_image_inspection(self):
        for name, path in (('Backgammon Game', 'backend/backgammon_project/settings.py'),
                           ('Backgammon Game', 'deploy/workspace/docker/python.Dockerfile'),
                           ('backgammon-tournaments', 'src/App.vue')):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                _, previous = self.fixture(root)
                def changes(repository, *args):
                    return path + '\0' if repository.name == name else ''
                with patch.object(release, 'git', side_effect=changes), patch.object(release, 'capture') as inspect:
                    with self.assertRaisesRegex(RuntimeError, 'inputs changed'):
                        release.resume_checks(root, previous['release_id'], previous['sources'])
                    inspect.assert_not_called()

    def test_wrong_stage_or_published_attempt_refused(self):
        for field, value in (('stage', 'checks_passed'), ('failed_stage', 'game-tests'),
                             ('published', {'game': 'commit-url'})):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                directory, previous = self.fixture(root)
                previous[field] = value
                release.save(directory / 'status.json', previous)
                with self.assertRaisesRegex(RuntimeError, 'unpublished local attempt'):
                    release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_missing_completed_log_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory, previous = self.fixture(root)
            (directory / '003-game-frontend-tests.log').unlink()
            with self.assertRaisesRegex(RuntimeError, 'Missing completed-stage log'):
                release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_retagged_or_relabelled_image_refused(self):
        for field, value in (('Id', 'sha256:' + 'e' * 64), ('Architecture', 'arm64'),
                             ('revision', 'e' * 40), ('release', 'different-release')):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                _, previous = self.fixture(root)
                item = self.image('game', previous)
                if field in ('revision', 'release'):
                    key = 'org.opencontainers.image.revision' if field == 'revision' else 'io.backgammon.release'
                    item['Config']['Labels'][key] = value
                else:
                    item[field] = value
                with patch.object(release, 'git', return_value=''), \
                     patch.object(release, 'capture', return_value=json.dumps([item]).encode()):
                    with self.assertRaisesRegex(RuntimeError, 'image identity differs'):
                        release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_missing_docker_image_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, previous = self.fixture(root)
            with patch.object(release, 'git', return_value=''), \
                 patch.object(release, 'capture', side_effect=RuntimeError('No such image')):
                with self.assertRaisesRegex(RuntimeError, 'No such image'):
                    release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_path_instead_of_release_id_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'local release ID'):
            release.resume_checks(Path('/workspace'), '../../production', manifest()['sources'])

    def test_resume_backend_failure_still_blocks_publication_and_keeps_old_checks_skipped(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = Mock(root=root, preflight_only=False, checks_only=False, resume_from=manifest()['release_id'])
            images = {kind: 'sha256:' + 'b' * 64 for kind in release.IMAGES}
            def fail(workspace, actual_images, runner):
                self.assertEqual(actual_images, images)
                runner.stage = 'game-migrations'
                raise RuntimeError('backend check failed')
            with patch.object(release, 'source_inventory', return_value=manifest()['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'resume_checks', return_value=(images, {'release_id': args.resume_from})), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'image_builds') as builds, \
                 patch.object(release, 'exported_workspace', return_value=root), \
                 patch.object(release, 'backend_checks', side_effect=fail), \
                 patch.object(release, 'publish') as publish, \
                 patch.object(release, 'upload_and_deploy') as deploy:
                with self.assertRaisesRegex(RuntimeError, 'backend check failed'):
                    release.local_main(args)
                frontend.assert_not_called()
                builds.assert_not_called()
                publish.assert_not_called()
                deploy.assert_not_called()
            status = json.loads(next(root.glob('artifacts/auto-releases/*/status.json')).read_text())
            self.assertEqual(status['failed_stage'], 'game-migrations')
            self.assertEqual(status['resumed_from']['release_id'], args.resume_from)

    def test_resume_checks_only_finishes_backend_and_dice_without_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'docker').mkdir()
            (root / 'docker/dice.Dockerfile').write_text('FROM elixir:1.17\nFROM debian:bookworm-slim\n')
            args = Mock(root=root, preflight_only=False, checks_only=True, resume_from=manifest()['release_id'])
            images = {kind: 'sha256:' + 'b' * 64 for kind in release.IMAGES}
            with patch.object(release, 'source_inventory', return_value=manifest()['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'resume_checks', return_value=(images, {'release_id': args.resume_from})), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'image_builds') as builds, \
                 patch.object(release, 'exported_workspace', return_value=root), \
                 patch.object(release, 'backend_checks') as backend, \
                 patch.object(release.Runner, 'run') as run, \
                 patch.object(release, 'publish') as publish, \
                 patch.object(release, 'upload_and_deploy') as deploy:
                release.local_main(args)
                frontend.assert_not_called()
                builds.assert_not_called()
                backend.assert_called_once()
                self.assertEqual(backend.call_args.args[1], images)
                self.assertEqual(run.call_args.args[0], 'dice-tests')
                publish.assert_not_called()
                deploy.assert_not_called()
            status = json.loads(next(root.glob('artifacts/auto-releases/*/status.json')).read_text())
            self.assertEqual(status['stage'], 'checks_passed')
            self.assertEqual(status['published'], {})


class FrontendResumeTests(unittest.TestCase):
    def fixture(self, root):
        previous = manifest()
        directory = root / 'artifacts/auto-releases' / previous['release_id']
        directory.mkdir(parents=True)
        status = dict(previous, stage='failed', failed_stage='admin-frontend-build', published={},
                      error='backgammon-tournaments: commit your changes before running this tool (including new files)')
        release.save(directory / 'status.json', status)
        for index, stage in enumerate(release.RESUME_COMPLETED_STAGES[:10], 1):
            (directory / f'{index:03d}-{stage}.log').write_text('completed\n')
        (directory / '010-admin-frontend-build.log').write_text('\x1b[32m✓ built in 1.23s\x1b[39m\n', encoding='utf-8')
        return directory, status

    def test_changed_tournaments_rechecked_with_unchanged_game_and_admin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory, previous = self.fixture(root)
            current = copy.deepcopy(previous['sources'])
            current['backgammon-tournaments']['revision'] = 'b' * 40
            current['Backgammon Game']['revision'] = 'c' * 40
            def changes(repository, *args):
                if repository.name == 'backgammon-tournaments':
                    return 'src/stores/auth.ts\0'
                return 'deploy/workspace/operations/release_pipeline.py\0' if repository.name == 'Backgammon Game' else ''
            before = (directory / 'status.json').read_bytes()
            with patch.object(release, 'git', side_effect=changes), patch.object(release, 'capture') as capture:
                images, evidence = release.resume_checks(root, previous['release_id'], current)
            self.assertIsNone(images)
            capture.assert_not_called()
            self.assertEqual(evidence['skipped_frontends'], ['game', 'admin'])
            self.assertEqual(evidence['rerun_frontends'], ['tournaments'])
            self.assertEqual(len(evidence['completed_log_sha256']), 10)
            self.assertEqual((directory / 'status.json').read_bytes(), before)

    def test_changed_game_or_admin_inputs_are_rejected(self):
        for name, path in (('Backgammon Game', 'frontend/src/App.tsx'),
                           ('backgammon-tournaments-backend', 'admin-frontend/src/App.vue')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                _, previous = self.fixture(root)
                with patch.object(release, 'git', side_effect=lambda repo, *args: path if repo.name == name else ''):
                    with self.assertRaisesRegex(RuntimeError, 'inputs changed'):
                        release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_incomplete_or_published_attempt_is_rejected(self):
        for failure in ('missing-log', 'incomplete-build', 'published', 'command-error'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                directory, previous = self.fixture(root)
                if failure == 'missing-log':
                    (directory / '003-game-frontend-tests.log').unlink()
                elif failure == 'incomplete-build':
                    (directory / '010-admin-frontend-build.log').write_text('build failed')
                else:
                    if failure == 'published':
                        previous['published'] = {'Backgammon Game': 'commit-url'}
                    else:
                        previous['error'] = 'admin-frontend-build failed (exit 1)'
                    release.save(directory / 'status.json', previous)
                with patch.object(release, 'git', return_value=''):
                    with self.assertRaises(RuntimeError):
                        release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_dirty_guard_always_rechecks_tournaments_even_with_same_commit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, previous = self.fixture(root)
            with patch.object(release, 'git', return_value=''):
                _, evidence = release.resume_checks(root, previous['release_id'], previous['sources'])
            self.assertEqual(evidence['rerun_frontends'], ['tournaments'])

    def test_selected_frontend_runs_only_its_install_tests_and_build(self):
        runner = Mock()
        with patch.object(release.shutil, 'which', return_value='pnpm'):
            release.frontend_checks(Path('workspace'), runner, only=['tournaments'])
        self.assertEqual([call.args[0] for call in runner.run.call_args_list],
                         ['tournaments-dependencies', 'tournaments-frontend-tests', 'tournaments-frontend-build'])

    def test_frontend_resume_builds_images_and_stops_before_publication_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = Mock(root=root, preflight_only=False, checks_only=False, resume_from=manifest()['release_id'])
            evidence = {'release_id': args.resume_from, 'rerun_frontends': ['tournaments']}
            with patch.object(release, 'source_inventory', return_value=manifest()['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'resume_checks', return_value=(None, evidence)), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'exported_workspace', return_value=root), \
                 patch.object(release, 'image_builds', side_effect=RuntimeError('image build failed')) as builds, \
                 patch.object(release, 'backend_checks') as backend, \
                 patch.object(release, 'publish') as publish, \
                 patch.object(release, 'upload_and_deploy') as deploy:
                with self.assertRaisesRegex(RuntimeError, 'image build failed'):
                    release.local_main(args)
                frontend.assert_called_once()
                self.assertEqual(frontend.call_args.kwargs['only'], ['tournaments'])
                builds.assert_called_once()
                backend.assert_not_called()
                publish.assert_not_called()
                deploy.assert_not_called()


class TournamentResumeTests(unittest.TestCase):
    def fixture(self, root):
        parent_directory, parent = FrontendResumeTests().fixture(root)
        previous = manifest()
        previous['release_id'] = 'bg-release-20261011t110345z-500d296c'
        directory = root / 'artifacts/auto-releases' / previous['release_id']
        directory.mkdir()
        with patch.object(release, 'git', return_value=''):
            _, evidence = release.resume_checks(root, parent['release_id'], previous['sources'])
        for index, stage in enumerate(release.TOURNAMENT_RESUME_STAGES, 1):
            contents = 'completed\n'
            if stage.startswith('build-'):
                contents = 'exporting config sha256:' + 'b' * 64 + '\nexporting manifest list sha256:' + 'c' * 64 + '\n'
            if stage == 'game-tests':
                contents = 'Ran 475 tests\n\nOK (skipped=1)\n'
            (directory / f'{index:03d}-{stage}.log').write_text(contents)
        failed_log = directory / '019-tournaments-tests.log'
        failed_log.write_text('FAILED (failures=86, errors=45, skipped=82)\n')
        status = dict(previous, stage='failed', failed_stage='tournaments-tests', published={},
                      error='tournaments-tests failed (exit 1). Log: ' + str(failed_log), resumed_from=evidence)
        release.save(directory / 'status.json', status)
        return directory, status, parent_directory

    def changes(self, paths):
        def changed(repository, *args):
            # Equal revisions also occur while validating the earlier receipt.
            if args[-3] == args[-2]:
                return ''
            return '\0'.join(paths.get(repository.name, []))
        return changed

    def test_only_changed_tournament_test_image_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory, previous, _ = self.fixture(root)
            current = copy.deepcopy(previous['sources'])
            current['backgammon-tournaments-backend']['revision'] = 'd' * 40
            before = (directory / 'status.json').read_bytes()
            paths = {'backgammon-tournaments-backend': ['tournaments/frontend/test_push_health.py']}
            with patch.object(release, 'git', side_effect=self.changes(paths)), \
                 patch.object(release, 'capture', side_effect=ResumeTests().fake_capture(previous)):
                images, evidence = release.resume_checks(root, previous['release_id'], current)
            self.assertEqual(set(images), set(release.IMAGES))
            self.assertEqual(evidence['rebuild_images'], ['tournaments'])
            self.assertEqual(evidence['resume_backend'], 'tournaments')
            self.assertEqual(len(evidence['completed_log_sha256']), 19)
            self.assertEqual((directory / 'status.json').read_bytes(), before)

    def test_unrelated_inputs_and_shared_game_settings_are_rejected(self):
        for name, path in (
            ('Backgammon Game', 'deploy/workspace/operations/release_test_settings.py'),
            ('Backgammon Game', 'backend/game/models.py'),
            ('backgammon-tournaments-backend', 'tournaments/tournaments/models.py'),
            ('backgammon-tournaments-backend', 'admin-frontend/src/App.vue'),
            ('backgammon-tournaments', 'src/App.vue'),
        ):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                _, previous, _ = self.fixture(root)
                current = copy.deepcopy(previous['sources'])
                current[name]['revision'] = 'd' * 40
                with patch.object(release, 'git', side_effect=self.changes({name: [path]})):
                    with self.assertRaisesRegex(RuntimeError, 'outside tournament test fixes'):
                        release.resume_checks(root, previous['release_id'], current)

    def test_missing_game_success_and_changed_frontend_evidence_are_rejected(self):
        for failure in ('game-failed', 'missing-stage', 'changed-parent', 'published', 'parent-self'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                directory, previous, parent_directory = self.fixture(root)
                if failure == 'game-failed':
                    (directory / '017-game-tests.log').write_text('FAILED\n')
                elif failure == 'missing-stage':
                    (directory / '003-tournaments-frontend-build.log').unlink()
                elif failure == 'changed-parent':
                    (parent_directory / '003-game-frontend-tests.log').write_text('altered\n')
                else:
                    if failure == 'published':
                        previous['published'] = {'Backgammon Game': 'commit-url'}
                    else:
                        previous['resumed_from']['release_id'] = previous['release_id']
                    release.save(directory / 'status.json', previous)
                with patch.object(release, 'git', return_value=''):
                    with self.assertRaises(RuntimeError):
                        release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_changed_retained_image_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, previous, _ = self.fixture(root)
            with patch.object(release, 'git', return_value=''), \
                 patch.object(release, 'capture', side_effect=ResumeTests().fake_capture(previous, digest='f')):
                with self.assertRaisesRegex(RuntimeError, 'Retained image identity differs'):
                    release.resume_checks(root, previous['release_id'], previous['sources'])

    def test_local_resume_skips_frontends_and_game_and_rebuilds_only_tournaments(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'docker').mkdir()
            (root / 'docker/dice.Dockerfile').write_text('FROM elixir:1.17\nFROM debian:bookworm-slim\n')
            args = Mock(root=root, preflight_only=False, checks_only=True, resume_from=manifest()['release_id'])
            images = {kind: 'retained-' + kind for kind in release.IMAGES}
            evidence = {'release_id': args.resume_from, 'resume_backend': 'tournaments', 'rebuild_images': ['tournaments']}
            with patch.object(release, 'source_inventory', return_value=manifest()['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'resume_checks', return_value=(images, evidence)), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'image_builds', return_value={'tournaments': 'rebuilt'}) as builds, \
                 patch.object(release, 'exported_workspace', return_value=root), \
                 patch.object(release, 'backend_checks') as backend, \
                 patch.object(release.Runner, 'run'), \
                 patch.object(release, 'publish') as publish:
                release.local_main(args)
                frontend.assert_not_called()
                self.assertEqual(builds.call_args.kwargs['kinds'], ['tournaments'])
                self.assertEqual(backend.call_args.kwargs['only'], ('tournaments', 'analysis'))
                self.assertEqual(backend.call_args.args[1]['tournaments'], 'rebuilt')
                self.assertEqual(backend.call_args.args[1]['game'], 'retained-game')
                self.assertEqual(images['tournaments'], 'retained-tournaments')
                publish.assert_not_called()

    def test_callback_keys_only_reach_tournament_test_containers(self):
        with tempfile.TemporaryDirectory() as folder:
            images = {kind: 'image-' + kind for kind in release.IMAGES}
            runner = Mock(directory=Path(folder))
            owned = {'Config': {'Labels': {'io.backgammon.release-test': 'owned'}}}
            result = Mock(returncode=0, stdout=json.dumps([owned]).encode())
            network = json.dumps([{'Labels': {'io.backgammon.release-test': 'owned'}}]).encode()
            with patch.object(release.uuid, 'uuid4', return_value=Mock(hex='owned')), \
                 patch.object(release.subprocess, 'run', return_value=result), \
                 patch.object(release, 'capture', return_value=network):
                release.backend_checks(Path(folder), images, runner)
            for call in runner.run.call_args_list:
                stage, command = call.args
                if stage.endswith(('-migrations', '-tests')):
                    keys = [arg for arg in command if str(arg).startswith(('GAMELINK_TICKET_SECRET=', 'GAMELINK_RESULT_SECRETS=', 'GAMELINK_COMMAND_SECRET='))]
                    self.assertEqual(len(keys), 3 if stage.startswith('tournaments-') else 0)
                    self.assertEqual(len({arg.split('=', 1)[1] for arg in keys}), len(keys))


class TestDiceServiceTests(unittest.TestCase):
    def test_built_image_runs_in_isolated_network_before_readiness(self):
        runner = Mock()
        created = []
        image = 'sha256:' + 'a' * 64
        labels = ['--label', 'io.backgammon.release-test=owned']
        release.start_test_dice({'dice': image}, runner, ['docker'], 'isolated', labels, created)
        self.assertEqual(created, ['isolated-dice'])
        start, ready = runner.run.call_args_list
        self.assertEqual(start.args[0], 'test-dice')
        command = start.args[1]
        self.assertEqual(command[-1], image)
        self.assertEqual(command[command.index('--network') + 1], 'isolated')
        self.assertEqual(command[command.index('--network-alias') + 1], 'release-dice')
        self.assertIn('io.backgammon.release-test=owned', command)
        self.assertIn('DICE_BIND_HOST=0.0.0.0', command)
        self.assertNotIn('-p', command)
        self.assertNotIn('--publish', command)
        self.assertNotIn('--mount', command)
        self.assertEqual(ready.args[0], 'test-dice-ready')
        self.assertEqual(ready.args[1][:4], ['docker', 'exec', 'isolated-dice', 'sh'])
        self.assertIn('http://127.0.0.1:4000/health', ready.args[1][-1])
        self.assertIn('--max-time 2', ready.args[1][-1])

    def test_failed_start_is_registered_for_cleanup(self):
        runner = Mock()
        runner.run.side_effect = RuntimeError('startup failed')
        created = []
        with self.assertRaisesRegex(RuntimeError, 'startup failed'):
            release.start_test_dice({'dice': 'pinned-image'}, runner, ['docker'], 'isolated', [], created)
        self.assertEqual(created, ['isolated-dice'])
        self.assertEqual(runner.run.call_count, 1)

    def check_backend_failure(self, failed_stage):
        with tempfile.TemporaryDirectory() as folder:
            runner = Mock(directory=Path(folder))
            images = {kind: 'sha256:' + 'a' * 64 for kind in release.IMAGES}
            stages = []
            def run(stage, command):
                stages.append(stage)
                if stage == 'game-tests':
                    self.assertLess(stages.index('test-dice-ready'), stages.index('game-tests'))
                    self.assertIn('DICE_SERVICE_URL=http://release-dice:4000', command)
                if stage == failed_stage:
                    raise RuntimeError('injected failure')
            runner.run.side_effect = run
            owned = {'Config': {'Labels': {'io.backgammon.release-test': 'owned'}}}
            result = Mock(returncode=0, stdout=json.dumps([owned]).encode())
            network = json.dumps([{'Labels': {'io.backgammon.release-test': 'owned'}}]).encode()
            with patch.object(release.uuid, 'uuid4', return_value=Mock(hex='owned')), \
                 patch.object(release.subprocess, 'run', return_value=result) as process, \
                 patch.object(release, 'capture', return_value=network):
                with self.assertRaisesRegex(RuntimeError, 'injected failure'):
                    release.backend_checks(Path(folder), images, runner)
                commands = [call.args[0] for call in process.call_args_list]
                self.assertIn(['docker', 'rm', '-f', 'bg-release-tests-owned-dice'], commands)
                self.assertIn(['docker', 'network', 'rm', 'bg-release-tests-owned'], commands)
            return stages

    def test_unready_dice_blocks_game_tests_and_cleans_up(self):
        stages = self.check_backend_failure('test-dice-ready')
        self.assertNotIn('game-tests', stages)

    def test_backend_tests_use_dice_and_cleanup_after_failure(self):
        stages = self.check_backend_failure('game-tests')
        self.assertIn('game-tests', stages)


class PublicationTests(unittest.TestCase):
    def test_any_remote_preflight_failure_prevents_all_pushes(self):
        runner = Mock()
        sources = manifest()['sources']
        def fake_git(repository, *args):
            if args[0] == 'ls-remote':
                return 'a' * 40 + '\trefs/heads/master'
            if repository.name == 'backgammon-tournaments' and args[0] == 'merge-base':
                raise RuntimeError('remote diverged')
            return ''
        with patch.object(release, 'assert_sources'), patch.object(release, 'git', side_effect=fake_git):
            with self.assertRaisesRegex(RuntimeError, 'remote diverged'):
                release.publish(Path('/workspace'), sources, runner, {})
        runner.run.assert_not_called()

    def test_push_failure_keeps_receipts_for_already_published_commits(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = Mock(directory=Path(directory))
            runner.run.side_effect = [None, RuntimeError('push denied')]
            receipt = {}
            def fake_git(repository, *args):
                return 'a' * 40 + '\trefs/heads/master' if args[0] == 'ls-remote' else ''
            with patch.object(release, 'assert_sources'), patch.object(release, 'git', side_effect=fake_git):
                with self.assertRaisesRegex(RuntimeError, 'push denied'):
                    release.publish(Path('/workspace'), manifest()['sources'], runner, receipt)
            self.assertEqual(len(receipt['published']), 1)
            self.assertEqual(runner.run.call_count, 2)
            self.assertEqual(json.loads((Path(directory) / 'status.json').read_text()), receipt)
            commands = [call.args[1] for call in runner.run.call_args_list]
            self.assertTrue(all('commit' not in command and '--force' not in command for command in commands))


class RuntimeTests(unittest.TestCase):
    def config(self):
        return {'name': release.PROJECT, 'services': {
            'game-api': {'image': 'old-game', 'environment': {'DB_NAME': 'live', 'REDIS_URL': 'redis://redis:6379/15'},
                         'volumes': [{'source': 'media', 'target': '/data/media'}]},
            'game-tasks': {'image': 'old-game', 'environment': {'DB_NAME': 'live'}},
            'postgres': {'image': 'postgres:16', 'volumes': [{'source': 'data', 'target': '/var/lib/postgresql/data'}]},
        }, 'volumes': {'data': {'name': 'production-data'}, 'media': {'name': 'production-media'}}}

    def test_only_images_change_api_and_worker_together(self):
        before = self.config()
        original = copy.deepcopy(before)
        after = release.updated_config(before, {'game': 'sha256:new'})
        self.assertEqual(before, original)
        self.assertEqual(after['services']['game-api']['image'], 'sha256:new')
        self.assertEqual(after['services']['game-tasks']['image'], 'sha256:new')
        self.assertEqual(after['services']['postgres'], before['services']['postgres'])
        self.assertEqual(after['services']['game-api']['environment'], before['services']['game-api']['environment'])
        self.assertEqual(after['volumes'], before['volumes'])

    def test_maintenance_preserves_other_applications(self):
        locations = '\n'.join('  location /backgammon/p' + str(index) + '/ { proxy_pass http://127.0.0.1:8005; }' for index in range(10))
        other = '  location /calendar/ { proxy_pass http://127.0.0.1:9000; }'
        text = 'server {\n' + locations + '\n' + other + '\n}'
        result = release.maintenance_config(text)
        self.assertEqual(result.count('return 503;'), 10)
        self.assertIn(other, result)
        self.assertEqual(result.replace('\n    if ($remote_addr != 127.0.0.1) { return 503; }\n', ''), text)

    def test_small_or_malformed_nginx_inventory_refused(self):
        for text in ('server { location /calendar/ { } }', 'location /backgammon/ {'):
            with self.assertRaises(RuntimeError):
                release.maintenance_config(text)

    def production(self):
        production = release.Production.__new__(release.Production)
        production.runner = Mock(directory=Path('/receipts'), stage='testing')
        production.compose = lambda file: ['docker', 'compose', '-f', str(file)]
        production.old_file = Path('/old.json')
        production.new_file = Path('/new.json')
        production.original_nginx = 'original'
        production.status = {}
        production.checkpoint = Mock()
        production.nginx_apply = Mock()
        production.maintenance = False
        production.stopped = False
        production.migrations_started = False
        production.writes_opened = False
        return production

    def test_failure_before_maintenance_does_not_restart_services(self):
        production = self.production()
        production.failed()
        self.assertEqual(production.runner.run.call_count, 1)
        self.assertIn('logs', production.runner.run.call_args.args[1])
        production.nginx_apply.assert_not_called()

    def test_failure_before_migration_restores_old_runtime_without_db_restore(self):
        production = self.production()
        production.maintenance = True
        production.failed()
        commands = [call.args[1] for call in production.runner.run.call_args_list]
        self.assertEqual(production.status['compose_file'], str(Path('/old.json')))
        self.assertTrue(all('pg_restore' not in command for command in commands))
        production.nginx_apply.assert_called_once_with('original', 'restore-original-routing')

    def test_migration_or_worker_write_failure_never_reopens_or_restores_old_data(self):
        for changed in ('migrations_started', 'writes_opened'):
            production = self.production()
            production.maintenance = True
            setattr(production, changed, True)
            production.failed()
            production.nginx_apply.assert_not_called()
            self.assertEqual(production.runner.run.call_count, 1)
            production.checkpoint.assert_called_once_with('maintenance_requires_attention')

    def test_deploy_detects_runtime_drift_before_maintenance(self):
        production = self.production()
        production.nginx = Path('/etc/nginx/production.conf')
        with patch.object(release, 'capture', return_value=b'changed'):
            with self.assertRaisesRegex(RuntimeError, 'Nginx changed'):
                production.deploy()
        self.assertFalse(production.maintenance)
        production.runner.run.assert_not_called()


class OutputTests(unittest.TestCase):
    def test_application_test_failure_blocks_push_and_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            arguments = Mock(root=Path(directory), preflight_only=False, checks_only=False, resume_from=None)
            def failed_tests(root, runner):
                runner.stage = 'tournaments-frontend-tests'
                raise RuntimeError('application test failed')
            with patch.object(release, 'source_inventory', return_value=manifest()['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'frontend_checks', side_effect=failed_tests), \
                 patch.object(release, 'publish') as publish, \
                 patch.object(release, 'upload_and_deploy') as deploy:
                with self.assertRaisesRegex(RuntimeError, 'application test failed'):
                    release.local_main(arguments)
                publish.assert_not_called()
                deploy.assert_not_called()
            status = json.loads(next(Path(directory).glob('artifacts/auto-releases/*/status.json')).read_text())
            self.assertEqual(status['failed_stage'], 'tournaments-frontend-tests')
            self.assertEqual(status['published'], {})

    def test_failed_command_prints_stderr_and_saves_it(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = release.Runner(Path(directory))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                with self.assertRaisesRegex(RuntimeError, 'exit 7'):
                    runner.run('synthetic-failure', [sys.executable, '-c',
                        "import sys; print('TEST_ERROR_DETAIL', file=sys.stderr); sys.exit(7)"])
            self.assertIn('TEST_ERROR_DETAIL', output.getvalue())
            self.assertIn('TEST_ERROR_DETAIL', next(Path(directory).glob('*.log')).read_text())

    def test_test_settings_refuse_runtime_use(self):
        code = Path(release.__file__).with_name('release_test_settings.py').read_text()
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'explicitly isolated'):
                exec(compile(code, 'release_test_settings.py', 'exec'), {})

    def test_test_settings_refuse_external_database_host(self):
        code = Path(release.__file__).with_name('release_test_settings.py').read_text()
        with patch.dict('os.environ', {'BACKGAMMON_RELEASE_TEST': '1', 'DB_HOST': 'production'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'disposable PostgreSQL'):
                exec(compile(code, 'release_test_settings.py', 'exec'), {})

    def test_clean_source_changes_stop_before_publication(self):
        with patch.object(release, 'source_inventory', return_value={'changed': True}):
            with self.assertRaisesRegex(RuntimeError, 'Source changed'):
                release.assert_sources(Path('/workspace'), manifest()['sources'])


@unittest.skipUnless(shutil.which('docker'), 'Docker Compose CLI unavailable')
class ComposeRoundTripTests(unittest.TestCase):
    def test_real_production_compose_survives_snapshot_and_image_update(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            environment = folder / 'release.env'
            environment.write_text('IMAGE_TAG=synthetic-check\nPUBLIC_HOST=example.test\nPUBLIC_ORIGIN=https://example.test\n'
                                   + 'CONFIG_DIR=' + folder.as_posix() + '\nTRANSFER_DIR=' + folder.as_posix() + '\n')
            recipe = Path(release.__file__).resolve().parents[1] / 'docker/compose.production.yaml'
            before = json.loads(release.capture(['docker', 'compose', '--env-file', environment,
                '-p', release.PROJECT, '-f', recipe, *release.PROFILES, 'config', '--format', 'json']))
            images = {kind: 'sha256:' + 'a' * 64 for kind in release.IMAGES}
            after = release.updated_config(before, images)
            snapshot = folder / 'runtime.json'
            release.save(snapshot, after)
            actual = json.loads(release.capture(['docker', 'compose', '-p', release.PROJECT,
                '-f', snapshot, *release.PROFILES, 'config', '--format', 'json']))
            self.assertEqual(actual, after)

    def test_runtime_dollars_and_volumes_survive_real_compose_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'original.json'
            snapshot = Path(directory) / 'snapshot.json'
            release.save(original, {'name': 'bg-release-roundtrip', 'services': {'probe': {
                'image': 'alpine:3', 'environment': {'TOKEN': 'literal$$value'},
                'command': ['sh', '-c', 'echo $$TOKEN'], 'labels': {'sample': 'label$$literal'},
                'volumes': [{'type': 'volume', 'source': 'data', 'target': '/data'}],
            }}, 'volumes': {'data': {'name': 'bg-release-roundtrip-data'}}})
            first = json.loads(release.capture(['docker', 'compose', '-f', original, 'config', '--format', 'json']))
            release.save(snapshot, first)
            second = json.loads(release.capture(['docker', 'compose', '-f', snapshot, 'config', '--format', 'json']))
            self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
