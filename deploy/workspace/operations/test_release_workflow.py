"""Continuation regressions using private temporary receipts and fake services."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_pipeline as release


TOOLS = {'release_pipeline.py': '1' * 64, 'release_test_settings.py': '2' * 64}


def manifest(number):
    return {'schema_version': 1, 'workflow_version': release.WORKFLOW_VERSION,
            'release_id': f'bg-release-20261012t1000{number:02d}z-000000{number:02x}', 'tools': TOOLS,
            'sources': {name: {'revision': 'a' * 40, 'branch': branch,
                              'url': 'https://github.com/' + origin + '.git'}
                        for name, (branch, origin, _) in release.SOURCES.items()}}


def emit(runner, stages, text='completed\n'):
    for stage in stages:
        runner.stage = stage
        runner.counter += 1
        (runner.directory / f'{runner.counter:03d}-{stage}.log').write_text(text, encoding='utf-8')
        runner.timings.append({'stage': stage, 'seconds': 1, 'exit_code': 0})
    release.save(runner.directory / 'timings.json', runner.timings)


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tools = patch.object(release, 'tool_hashes', return_value=TOOLS)
        self.tools.start()
        self.addCleanup(self.tools.stop)

    def progress(self, root, number, previous=None, scope='local'):
        value = manifest(number)
        runner = release.Runner(root / value['release_id'])
        release.save(runner.directory / 'status.json', dict(value, stage='failed_before_production_change',
                     production_changed=False, migrations_started=False, public_writes_opened=False))
        return release.ReleaseProgress(runner, value, scope, previous)

    def old(self, progress):
        return progress.runner.directory, copy.deepcopy(progress.value)

    def complete(self, progress, name='frontend-game', inputs=None):
        progress.run(name, ['test'], lambda: emit(progress.runner, ['test']), inputs=inputs)

    def test_completed_phase_reused_and_original_receipt_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            before = (old.runner.directory / 'progress.json').read_bytes()
            new = self.progress(root, 2, self.old(old))
            action = Mock()
            new.run('frontend-game', ['test'], action)
            action.assert_not_called()
            self.assertEqual(new.runner.timings[0]['exit_code'], 0)
            self.assertIn('reused_from', new.runner.timings[0])
            self.assertEqual((old.runner.directory / 'progress.json').read_bytes(), before)

    def test_partial_failed_phase_is_not_checkpointed(self):
        with tempfile.TemporaryDirectory() as folder:
            progress = self.progress(Path(folder), 1)
            def fail():
                emit(progress.runner, ['first'])
                raise RuntimeError('suite failed')
            with self.assertRaisesRegex(RuntimeError, 'suite failed'):
                progress.run('backend-game', ['first', 'second'], fail)
            actual = json.loads((progress.runner.directory / 'progress.json').read_text())
            self.assertNotIn('backend-game', actual['phases'])

    def test_successful_return_without_all_commands_is_not_checkpointed(self):
        with tempfile.TemporaryDirectory() as folder:
            progress = self.progress(Path(folder), 1)
            with self.assertRaisesRegex(RuntimeError, 'did not complete'):
                progress.run('backend-game', ['first', 'second'], lambda: emit(progress.runner, ['first']))
            self.assertNotIn('backend-game', progress.value['phases'])

    def test_changed_log_refuses_reuse_before_action(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            (old.runner.directory / '001-test.log').write_text('changed')
            new = self.progress(root, 2, self.old(old))
            action = Mock()
            with self.assertRaisesRegex(RuntimeError, 'evidence changed'):
                new.run('frontend-game', ['test'], action)
            action.assert_not_called()

    def test_changed_image_inputs_rerun_backend_instead_of_reusing_test(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old, 'backend-game', {'game': 'old-image'})
            new = self.progress(root, 2, self.old(old))
            action = Mock(side_effect=lambda: emit(new.runner, ['test']))
            new.run('backend-game', ['test'], action, inputs={'game': 'new-image'})
            action.assert_called_once()
            self.assertNotIn('reused_from', new.runner.timings[0])

    def test_changed_node_version_reruns_frontend(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old, inputs={'node': 'v22'})
            new = self.progress(root, 2, self.old(old))
            action = Mock(side_effect=lambda: emit(new.runner, ['test']))
            new.run('frontend-game', ['test'], action, inputs={'node': 'v24'})
            action.assert_called_once()

    def test_new_commits_or_tool_hashes_are_not_automatic_candidates(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            sources = copy.deepcopy(manifest(1)['sources'])
            sources['Backgammon Game']['revision'] = 'b' * 40
            self.assertIsNone(release.latest_progress(root, sources, 'local'))
            with patch.object(release, 'tool_hashes', return_value={'changed': 'hash'}):
                self.assertIsNone(release.latest_progress(root, manifest(1)['sources'], 'local'))

    def test_changed_result_is_not_reused_even_with_valid_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            prior = self.old(old)
            prior[1]['phases']['frontend-game']['result'] = 'tampered'
            new = self.progress(root, 2, prior)
            with self.assertRaisesRegex(RuntimeError, 'result changed'):
                new.run('frontend-game', ['test'], Mock())

    def test_log_path_cannot_escape_receipt_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            prior = self.old(old)
            prior[1]['phases']['frontend-game']['logs'][0]['file'] = '../../production.json'
            new = self.progress(root, 2, prior)
            with self.assertRaisesRegex(RuntimeError, 'Unsafe retained log'):
                new.run('frontend-game', ['test'], Mock())

    def test_early_failure_does_not_hide_completed_parent_phases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            self.complete(old)
            interrupted = self.progress(root, 2, self.old(old))
            new = self.progress(root, 3, self.old(interrupted))
            action = Mock()
            new.run('frontend-game', ['test'], action)
            action.assert_not_called()

    def test_continuation_cycle_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            old.value['previous_release'] = old.runner.directory.name
            release.save(old.runner.directory / 'progress.json', old.value)
            new = self.progress(root, 2, self.old(old))
            with self.assertRaisesRegex(RuntimeError, 'cycle'):
                new.run('frontend-game', ['test'], Mock())

    def test_server_migration_or_opened_writes_require_recovery(self):
        for key in ('production_changed', 'migrations_started', 'public_writes_opened'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                old = self.progress(root, 1, scope='server')
                self.complete(old)
                status = json.loads((old.runner.directory / 'status.json').read_text())
                status[key] = True
                status['stage'] = 'maintenance_requires_attention'
                release.save(old.runner.directory / 'status.json', status)
                with self.assertRaisesRegex(RuntimeError, 'manual recovery'):
                    release.latest_progress(root, manifest(1)['sources'], 'server')

    def test_local_phase_cannot_be_used_as_server_phase(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            with self.assertRaisesRegex(RuntimeError, 'inputs differ'):
                self.progress(root, 2, self.old(old), scope='server')

    def test_manifest_digest_is_retained_as_actual_docker_id(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = self.progress(root, 1)
            images = {kind: 'sha256:' + 'c' * 64 for kind in release.IMAGES}
            stages = ['build-' + kind for kind in release.IMAGES]
            def build():
                emit(old.runner, stages, 'exporting config sha256:' + 'b' * 64
                     + '\nexporting manifest sha256:' + 'c' * 64 + '\n')
                return images
            old.run('images', stages, build)
            new = self.progress(root, 2, self.old(old))
            item = {'Id': images['game'], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {
                'org.opencontainers.image.revision': 'a' * 40, 'io.backgammon.release': manifest(1)['release_id']}}}
            with patch.object(release, 'capture', return_value=json.dumps([item]).encode()) as capture:
                action = Mock()
                result = new.run('images', stages, action,
                                 verify=lambda value, origin: release.verify_images(value, manifest(1)['sources'], origin))
            action.assert_not_called()
            self.assertEqual(result['game'], 'sha256:' + 'c' * 64)
            self.assertTrue(all(call.args[0][-1] == 'sha256:' + 'c' * 64 for call in capture.call_args_list))

    def test_swapping_image_id_is_rejected_by_its_build_log(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            images = {kind: 'sha256:' + 'c' * 64 for kind in release.IMAGES}
            log = root / 'build.log'
            log.write_text('exporting manifest sha256:' + 'c' * 64)
            images['game'] = 'sha256:' + 'd' * 64
            with self.assertRaisesRegex(RuntimeError, 'does not belong'):
                release.verify_image_logs(images, {'build-' + kind: log for kind in release.IMAGES})

    def test_missing_image_causes_cache_miss_and_wrong_labels_stop_reuse(self):
        images = {kind: 'sha256:' + 'c' * 64 for kind in release.IMAGES}
        with patch.object(release, 'capture', side_effect=RuntimeError('No such image: sha256:missing')):
            self.assertFalse(release.verify_images(images, manifest(1)['sources'], manifest(1)['release_id']))
        item = {'Id': images['game'], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {}}}
        with patch.object(release, 'capture', return_value=json.dumps([item]).encode()):
            with self.assertRaisesRegex(RuntimeError, 'identity differs'):
                release.verify_images(images, manifest(1)['sources'], manifest(1)['release_id'])


class AutomaticWorkflowTests(unittest.TestCase):
    def run_local(self, root, **changes):
        arguments = argparse.Namespace(root=root, resume_from=None, fresh=False, checks_only=False, preflight_only=False)
        for key, value in changes.items():
            setattr(arguments, key, value)
        return release.local_main(arguments)

    def test_queued_result_blocks_even_while_health_is_ok(self):
        with self.assertRaisesRegex(RuntimeError, 'not drained'):
            release.require_ready({'active_count': 0, 'delivery': {'status': 'ok', 'queued_results': 1}})

    def test_active_game_diagnostic_includes_room_code(self):
        with self.assertRaisesRegex(RuntimeError, 'F570E6'):
            release.require_ready({'active_count': 1, 'rooms': [{'code': 'F570E6'}]})

    def test_blocked_server_stops_before_tests_builds_and_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                 patch.object(release, 'source_inventory', return_value=manifest(1)['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'server_readiness', return_value={'active_count': 1, 'rooms': [{'code': 'busy'}]}), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'image_builds') as builds, \
                 patch.object(release, 'publish') as publish, \
                 patch.object(release, 'upload_and_deploy') as deploy:
                with self.assertRaisesRegex(RuntimeError, 'active/waiting'):
                    self.run_local(root)
                frontend.assert_not_called()
                builds.assert_not_called()
                publish.assert_not_called()
                deploy.assert_not_called()

    def test_preflight_has_no_ssh_or_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                 patch.object(release, 'source_inventory', return_value=manifest(1)['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'server_readiness') as readiness, \
                 patch.object(release, 'publish') as publish:
                self.run_local(root, preflight_only=True)
                readiness.assert_not_called()
                publish.assert_not_called()

    def test_already_deployed_commits_do_not_rebuild_or_publish(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                 patch.object(release, 'source_inventory', return_value=manifest(1)['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'server_readiness', return_value={'already_current': True, 'current_release': 'current'}), \
                 patch.object(release, 'frontend_checks') as frontend, \
                 patch.object(release, 'publish') as publish:
                self.run_local(root)
                frontend.assert_not_called()
                publish.assert_not_called()
            status = json.loads(next(root.glob('artifacts/auto-releases/*/status.json')).read_text())
            self.assertEqual(status['stage'], 'production_open')
            self.assertTrue(status['already_current'])

    def test_upload_failure_reuses_completed_checks_when_same_command_runs_again(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sources = manifest(1)['sources']
            images = {kind: 'sha256:' + 'c' * 64 for kind in release.IMAGES}
            origin = {}
            def capture(args, cwd=None):
                if 'inspect' in args:
                    if args[-1] in ('postgres:16', 'redis:7-alpine'):
                        return json.dumps([{'Id': 'sha256:' + ('e' if args[-1] == 'postgres:16' else 'f') * 64}]).encode()
                    return json.dumps([{'Id': args[-1], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {
                        'org.opencontainers.image.revision': 'a' * 40, 'io.backgammon.release': origin['release']}}}]).encode()
                return b'linux' if 'info' in args else b'stable-runtime-version'
            def exported(source_root, value, target):
                (target / 'docker').mkdir(parents=True)
                (target / 'docker/dice.Dockerfile').write_text('FROM elixir:1.17\nFROM debian:bookworm-slim\n')
                return target
            def frontend(source_root, runner, only):
                site = only[0]
                stages = [site + '-dependencies'] + (['playwright-browser'] if site == 'game' else [])
                emit(runner, stages + [site + '-frontend-tests', site + '-frontend-build'])
            def build(workspace, value, runner, sudo=False):
                origin['release'] = value['release_id']
                emit(runner, ['build-' + kind for kind in release.IMAGES],
                     'exporting config sha256:' + 'b' * 64 + '\nexporting manifest sha256:' + 'c' * 64 + '\n')
                return images
            def backend(workspace, actual_images, runner, sudo=False, only=None, test_images=None):
                kind = only[0]
                stages = ['test-network', 'test-postgres', 'test-redis', kind + '-migrations']
                if kind == 'game':
                    stages += ['test-dice', 'test-dice-ready']
                emit(runner, stages + [kind + '-tests'])
            def publish(source_root, actual_sources, runner, receipt):
                receipt['published'] = {name: 'https://example.test/commit' for name in actual_sources}
                release.save(runner.directory / 'status.json', receipt)
            def upload_fail(value, runner):
                runner.stage = 'upload-release'
                raise RuntimeError('upload failed')
            with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                 patch.object(release, 'source_inventory', return_value=sources), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', side_effect=capture), \
                 patch.object(release, 'git', return_value='a' * 40 + '\trefs/heads/master'), \
                 patch.object(release, 'server_readiness', return_value={
                     'active_count': 0, 'delivery': {'status': 'ok', 'queued_results': 0}}), \
                 patch.object(release, 'frontend_checks', side_effect=frontend) as frontends, \
                 patch.object(release, 'image_builds', side_effect=build) as builds, \
                 patch.object(release, 'backend_checks', side_effect=backend) as backends, \
                 patch.object(release, 'exported_workspace', side_effect=exported), \
                 patch.object(release.Runner, 'run', autospec=True,
                              side_effect=lambda runner, stage, args, **kwargs: emit(runner, [stage])), \
                 patch.object(release, 'publish', side_effect=publish), \
                 patch.object(release, 'upload_and_deploy', side_effect=upload_fail) as upload:
                with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                    self.run_local(root)
                upload.side_effect = None
                self.run_local(root)
                self.assertEqual(frontends.call_count, 3)
                self.assertEqual(builds.call_count, 1)
                self.assertEqual(backends.call_count, 3)
                self.assertEqual(upload.call_count, 2)
            receipts = [json.loads(path.read_text()) for path in root.glob('artifacts/auto-releases/*/status.json')]
            self.assertEqual({item['stage'] for item in receipts}, {'failed', 'production_open'})

    def test_fresh_ignores_prior_progress(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                 patch.object(release, 'source_inventory', return_value=manifest(1)['sources']), \
                 patch.object(release.shutil, 'which', return_value='tool'), \
                 patch.object(release, 'capture', return_value=b'linux'), \
                 patch.object(release, 'latest_progress') as latest:
                self.run_local(root, fresh=True, preflight_only=True)
                latest.assert_not_called()


if __name__ == '__main__':
    unittest.main()
