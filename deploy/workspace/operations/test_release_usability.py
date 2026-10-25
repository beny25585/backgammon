"""Local release usability contracts using temporary receipts and mocked tools only."""
import argparse
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_pipeline as release
from test_release_workflow import TOOLS, emit, manifest


class FrontendInputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / 'Backgammon Game/frontend'
        self.directory.mkdir(parents=True)
        self.sources = manifest(1)['sources']
        self.runtime = {'node': 'v22.18.0', 'pnpm': '10.33.2', 'platform': 'win32'}
        self.enterContext(patch.dict(os.environ, {'PATH': 'fixture-tools', 'CI': 'false',
                                                   'PRIVATE_RELEASE_VALUE': 'private-environment-marker'}, clear=True))
        self.enterContext(patch.object(release.shutil, 'which', return_value='fixture-pnpm'))
        self.capture = self.enterContext(patch.object(release, 'capture', return_value=b'{"registry":"fixture"}'))

    def inputs(self, sources=None, runtime=None):
        return release.frontend_phase_inputs(self.root, 'game', sources or self.sources, runtime or self.runtime)

    def test_identical_inputs_are_stable_and_other_repository_revisions_do_not_change_them(self):
        first = self.inputs()
        changed = copy.deepcopy(self.sources)
        for name in changed:
            if name != 'Backgammon Game':
                changed[name]['revision'] = 'b' * 40
        self.assertEqual(first, self.inputs(changed))
        self.assertEqual(first, self.inputs())
        self.assertIn('a' * 40, json.dumps(first, sort_keys=True))

    def test_target_revision_and_each_runtime_component_change_inputs(self):
        first = self.inputs()
        changed = copy.deepcopy(self.sources)
        changed['Backgammon Game']['revision'] = 'b' * 40
        self.assertNotEqual(first, self.inputs(changed))
        for key in self.runtime:
            with self.subTest(runtime=key):
                self.assertNotEqual(first, self.inputs(runtime={**self.runtime, key: 'different'}))

    def test_inherited_environment_is_hashed_and_ci_matches_the_command_environment(self):
        first = self.inputs()
        with patch.dict(os.environ, {'PRIVATE_RELEASE_VALUE': 'changed-private-marker'}):
            self.assertNotEqual(first, self.inputs())
        with patch.dict(os.environ, {'CI': 'true'}):
            self.assertEqual(first, self.inputs(), 'Both frontend execution and fingerprints force CI=true')
        self.assertNotIn('private-environment-marker', json.dumps(first))

    def test_private_environment_files_are_hashed_without_recording_their_contents(self):
        first = self.inputs()
        private = self.directory / '.env.production.local'
        private.write_text('PRIVATE_TEST_KEY=private-file-marker\n', encoding='utf-8')
        second = self.inputs()
        self.assertNotEqual(first, second)
        serialized = json.dumps(second)
        self.assertIn(hashlib.sha256(private.read_bytes()).hexdigest(), serialized)
        self.assertNotIn('private-file-marker', serialized)
        private.write_text('PRIVATE_TEST_KEY=changed-file-marker\n', encoding='utf-8')
        self.assertNotEqual(second, self.inputs())
        private.unlink()
        self.assertEqual(first, self.inputs())

    def test_effective_pnpm_configuration_changes_inputs_and_never_leaks_private_values(self):
        self.capture.return_value = b'{"registry":"fixture","private":"private-config-marker"}'
        first = self.inputs()
        self.capture.assert_called_with(['fixture-pnpm', 'config', 'list', '--json'], cwd=self.directory)
        self.assertIn(hashlib.sha256(self.capture.return_value).hexdigest(), json.dumps(first))
        self.assertNotIn('private-config-marker', json.dumps(first))
        self.capture.return_value = b'{"registry":"different"}'
        self.assertNotEqual(first, self.inputs())

    def test_ignored_alternate_build_config_invalidates_old_frontend_evidence(self):
        first = self.inputs()
        alternate = self.directory / 'vite.config.js'
        alternate.write_text('export default { base: "/old/" }', encoding='utf-8')
        second = self.inputs()
        self.assertNotEqual(first, second)
        alternate.write_text('export default { base: "/new/" }', encoding='utf-8')
        self.assertNotEqual(second, self.inputs())
        alternate.unlink()
        self.assertEqual(first, self.inputs())

    def test_external_browser_replaced_at_same_path_invalidates_its_evidence(self):
        browser = self.root / 'fixture-browser.exe'
        browser.write_bytes(b'old-browser')
        with patch.dict(os.environ, {'CHROMIUM_PATH': str(browser)}):
            first = self.inputs()
            browser.write_bytes(b'new-browser')
            self.assertNotEqual(first, self.inputs())


class FrontendReceiptReuseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.receipts = self.root / 'artifacts/auto-releases'
        self.enterContext(patch.object(release, 'tool_hashes', return_value=TOOLS))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        # A stray invocation must fail rather than launch Git, Docker or pnpm.
        self.capture = self.enterContext(patch.object(release, 'capture', side_effect=AssertionError('Unexpected external tool')))
        self.sources = manifest(1)['sources']
        self.inputs = {'node': 'v22', 'pnpm': '10', 'environment_sha256': 'e' * 64,
                       'pnpm_config_sha256': 'c' * 64, 'config_files': {'.env.local': 'f' * 64}}

    def progress(self, number, *, sources=None, scope='local'):
        value = manifest(number)
        value['sources'] = copy.deepcopy(sources or self.sources)
        runner = release.Runner(self.receipts / value['release_id'])
        release.save(runner.directory / 'status.json', dict(value, stage='failed', published={},
                     production_changed=False, migrations_started=False, public_writes_opened=False))
        return release.ReleaseProgress(runner, value, scope)

    def changed_other_repository(self):
        sources = copy.deepcopy(self.sources)
        sources['backgammon-analysis-service']['revision'] = 'b' * 40
        return sources

    def complete(self, progress, *, name='frontend-game', inputs=None):
        progress.run(name, ['fixture-check'], lambda: emit(progress.runner, ['fixture-check']),
                     inputs=self.inputs if inputs is None else inputs)

    def run_phase(self, progress, *, name='frontend-game', inputs=None, reuse=True):
        action = Mock(side_effect=lambda: emit(progress.runner, ['fixture-check']))
        progress.run(name, ['fixture-check'], action, inputs=self.inputs if inputs is None else inputs,
                     reuse_frontend=reuse)
        return action

    def rewrite_progress(self, progress, edit):
        path = progress.runner.directory / 'progress.json'
        value = json.loads(path.read_text(encoding='utf-8'))
        edit(value)
        release.save(path, value)

    def test_unrelated_repository_revision_can_reuse_frontend_without_rewriting_original_receipt(self):
        old = self.progress(1)
        self.complete(old)
        before = {name: (old.runner.directory / name).read_bytes() for name in ('progress.json', 'status.json', '001-fixture-check.log')}
        new = self.progress(2, sources=self.changed_other_repository())
        action = self.run_phase(new)
        action.assert_not_called()
        self.assertIn('reused_from', new.runner.timings[0])
        self.assertEqual(new.value['phases']['frontend-game']['origin_release'], old.runner.directory.name)
        for name, contents in before.items():
            self.assertEqual((old.runner.directory / name).read_bytes(), contents)
        self.capture.assert_not_called()

    def test_target_repository_revision_change_cannot_reuse_even_when_supplied_fingerprint_is_equal(self):
        old = self.progress(1)
        self.complete(old)
        sources = self.changed_other_repository()
        sources['Backgammon Game']['revision'] = 'd' * 40
        new = self.progress(2, sources=sources)
        self.run_phase(new).assert_called_once()
        self.assertNotIn('reused_from', new.runner.timings[0])

    def test_environment_configuration_and_runtime_changes_each_force_reexecution(self):
        old = self.progress(1)
        self.complete(old)
        cases = ({'environment_sha256': 'a' * 64}, {'pnpm_config_sha256': 'b' * 64},
                 {'config_files': {'.env.local': 'a' * 64}}, {'node': 'v24'}, {'pnpm': '11'})
        for number, change in enumerate(cases, 2):
            with self.subTest(changed=list(change)):
                new = self.progress(number, sources=self.changed_other_repository())
                self.run_phase(new, inputs={**self.inputs, **change}).assert_called_once()
                self.assertNotIn('reused_from', new.runner.timings[0])

    def test_default_flag_disables_cross_revision_frontend_reuse(self):
        old = self.progress(1)
        self.complete(old)
        new = self.progress(2, sources=self.changed_other_repository())
        action = Mock(side_effect=lambda: emit(new.runner, ['fixture-check']))
        new.run('frontend-game', ['fixture-check'], action, inputs=self.inputs)
        action.assert_called_once()
        self.assertNotIn('reused_from', new.runner.timings[0])

    def test_global_latest_progress_still_requires_all_four_revisions_to_match(self):
        old = self.progress(1)
        self.complete(old)
        self.assertIsNone(release.latest_progress(self.receipts, self.changed_other_repository(), 'local'))

    def test_workflow_or_tool_changes_exclude_old_frontend_evidence(self):
        for number, field in enumerate(('workflow_version', 'tools'), 1):
            with self.subTest(field=field):
                inputs = {**self.inputs, 'fixture_case': field}
                old = self.progress(number * 2 - 1)
                self.complete(old, inputs=inputs)
                replacement = -1 if field == 'workflow_version' else {'other': 'digest'}
                self.rewrite_progress(old, lambda value: value.update({field: replacement}))
                new = self.progress(number * 2, sources=self.changed_other_repository())
                self.run_phase(new, inputs=inputs).assert_called_once()

    def test_nonoriginal_phase_is_not_a_cross_revision_candidate(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite_progress(old, lambda value: value['phases']['frontend-game'].update(origin_release=manifest(9)['release_id']))
        new = self.progress(2, sources=self.changed_other_repository())
        self.run_phase(new).assert_called_once()

    def test_invalid_four_source_status_is_refused_before_reuse_or_action(self):
        old = self.progress(1)
        self.complete(old)
        path = old.runner.directory / 'status.json'
        status = json.loads(path.read_text())
        del status['sources']['backgammon-analysis-service']
        release.save(path, status)
        new = self.progress(2, sources=self.changed_other_repository())
        action = Mock()
        with self.assertRaisesRegex(RuntimeError, 'source set'):
            new.run('frontend-game', ['fixture-check'], action, inputs=self.inputs, reuse_frontend=True)
        action.assert_not_called()

    def test_progress_and_status_source_mismatch_is_refused(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite_progress(old, lambda value: value['sources']['backgammon-analysis-service'].update(revision='d' * 40))
        new = self.progress(2, sources=self.changed_other_repository())
        action = Mock()
        with self.assertRaisesRegex(RuntimeError, 'sources differ'):
            new.run('frontend-game', ['fixture-check'], action, inputs=self.inputs, reuse_frontend=True)
        action.assert_not_called()

    def test_tampered_logs_and_results_are_rejected_by_existing_evidence_checks(self):
        for index, changed in enumerate(('log', 'result'), 1):
            with self.subTest(changed=changed):
                old = self.progress(index * 2 - 1)
                self.complete(old)
                if changed == 'log':
                    (old.runner.directory / '001-fixture-check.log').write_text('tampered')
                else:
                    self.rewrite_progress(old, lambda value: value['phases']['frontend-game'].update(result='tampered'))
                new = self.progress(index * 2, sources=self.changed_other_repository())
                action = Mock()
                with self.assertRaisesRegex(RuntimeError, 'evidence changed|result changed'):
                    new.run('frontend-game', ['fixture-check'], action, inputs=self.inputs, reuse_frontend=True)
                action.assert_not_called()

    def test_extra_candidate_flag_never_allows_backend_images_or_server_phases(self):
        for number, (name, scope) in enumerate((('backend-game', 'local'), ('images', 'local'),
                                                ('frontend-game', 'server')), 1):
            with self.subTest(phase=name, scope=scope):
                new = self.progress(number, scope=scope)
                action = Mock()
                with self.assertRaisesRegex(RuntimeError, 'local frontend'):
                    new.run(name, ['fixture-check'], action, inputs=self.inputs, reuse_frontend=True)
                action.assert_not_called()


class LocalUsabilityEntryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_missing_prerequisites_are_aggregated_before_git_or_docker_queries(self):
        with patch.object(release.shutil, 'which', return_value=None), \
             patch.object(release, 'source_inventory') as inventory, patch.object(release, 'capture') as capture:
            with self.assertRaises(RuntimeError) as raised:
                release.local_environment(self.root)
        for name in ('git', 'docker', 'node', 'pnpm', 'ssh', 'scp'):
            self.assertIn(name, str(raised.exception))
        inventory.assert_not_called()
        capture.assert_not_called()

    def test_local_only_prerequisites_do_not_require_ssh_or_scp(self):
        sources = manifest(1)['sources']
        with patch.object(release.shutil, 'which', side_effect=lambda name: None if name in ('ssh', 'scp') else 'fixture-tool'), \
             patch.object(release, 'source_inventory', return_value=sources), \
             patch.object(release, 'capture', return_value=b'linux') as capture:
            self.assertEqual(release.local_environment(self.root, require_remote=False), sources)
        capture.assert_called_once_with(['docker', 'info', '--format', '{{.OSType}}'])

    def test_status_reads_latest_safe_receipt_and_timings_without_prerequisites_or_processes(self):
        value = manifest(1)
        directory = self.root / 'artifacts/auto-releases' / value['release_id']
        release.save(directory / 'status.json', dict(value, stage='failed', failed_stage='analysis-tests'))
        release.save(directory / 'timings.json', [{'stage': 'frontend-game', 'seconds': 12.5, 'exit_code': 0}])
        release.save(directory.parent / 'not-a-release/status.json', {'release_id': 'private-decoy'})
        output = io.StringIO()
        with patch.object(release, 'local_environment') as prerequisites, \
             patch.object(release, 'source_inventory') as inventory, patch.object(release, 'capture') as capture, \
             patch.object(release, 'git') as git, contextlib.redirect_stdout(output):
            release.show_local_status(self.root)
        self.assertIn(value['release_id'], output.getvalue())
        self.assertIn('analysis-tests', output.getvalue())
        self.assertIn('frontend-game', output.getvalue())
        self.assertIn('12.5', output.getvalue())
        self.assertNotIn('private-decoy', output.getvalue())
        for mocked in (prerequisites, inventory, capture, git):
            mocked.assert_not_called()

    def test_empty_status_does_not_create_a_receipt_directory(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(release, 'capture') as capture:
            release.show_local_status(self.root)
        self.assertIn('No local release', output.getvalue())
        self.assertFalse((self.root / 'artifacts').exists())
        capture.assert_not_called()

    def test_status_cli_never_dispatches_the_release_workflow(self):
        with patch.object(sys, 'argv', ['release_pipeline.py', '--root', str(self.root), '--status']), \
             patch.object(release, 'show_local_status') as status, patch.object(release, 'local_main') as local:
            self.assertEqual(release.main(), 0)
        status.assert_called_once_with(self.root)
        local.assert_not_called()

    def test_conflicting_cli_modes_stop_before_status_or_release(self):
        for options in (['--checks-only', '--preflight-only'], ['--status', '--fresh']):
            with self.subTest(options=options), \
                 patch.object(sys, 'argv', ['release_pipeline.py', *options]), \
                 patch.object(release, 'show_local_status') as status, patch.object(release, 'local_main') as local, \
                 contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(release.main(), 1)
                status.assert_not_called()
                local.assert_not_called()

    def test_checks_only_failure_retry_stays_local_and_drops_fresh(self):
        args = argparse.Namespace(root=self.root, resume_from=None, fresh=True,
                                  checks_only=True, preflight_only=False)
        output = io.StringIO()
        with patch.object(release, 'tool_hashes', return_value=TOOLS), \
             patch.object(release, 'local_environment', return_value=manifest(1)['sources']), \
             patch.object(release, 'capture', return_value=b'fixture-runtime'), \
             patch.object(release.ReleaseProgress, 'run', side_effect=RuntimeError('fixture check failure')), \
             patch.object(release, 'server_readiness') as readiness, \
             patch.object(release, 'publish_exact') as publish, patch.object(release, 'upload_and_deploy') as deploy, \
             contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, 'fixture check failure'):
                release.automatic_local_main(args)
        self.assertIn('retry: .\\PUBLISH_AND_DEPLOY.ps1 -ChecksOnly', output.getvalue())
        self.assertNotIn(' -Fresh', output.getvalue())
        for mocked in (readiness, publish, deploy):
            mocked.assert_not_called()

    def test_fresh_caller_disables_extra_frontend_reuse_without_running_phase_actions(self):
        for fresh in (False, True):
            with self.subTest(fresh=fresh):
                flags = []
                def phase(progress, name, stages, action, inputs=None, verify=None, reuse_frontend=False):
                    if name.startswith('frontend-'):
                        flags.append(reuse_frontend)
                    return None
                arguments = argparse.Namespace(root=self.root, resume_from=None, fresh=fresh,
                                               checks_only=True, preflight_only=False)
                with patch.object(release, 'tool_hashes', return_value=TOOLS), \
                     patch.object(release, 'local_environment', return_value=manifest(1)['sources']), \
                     patch.object(release, 'latest_progress', return_value=None) as latest, \
                     patch.object(release, 'frontend_phase_inputs', return_value={'fixture': True}), \
                     patch.object(release.shutil, 'which', return_value='fixture-tool'), \
                     patch.object(release, 'capture', return_value=b'fixture-runtime'), \
                     patch.object(release.ReleaseProgress, 'run', autospec=True, side_effect=phase), \
                     patch.object(release, 'assert_sources'), patch.object(release, 'exported_workspace'), \
                     patch.object(release, 'checked_images'), patch.object(release, 'checked_backends'), \
                     patch.object(release, 'frontend_checks') as frontend, patch.object(release, 'publish_exact') as publish, \
                     patch.object(release, 'upload_and_deploy') as deploy, contextlib.redirect_stdout(io.StringIO()):
                    release.automatic_local_main(arguments)
                self.assertEqual(flags, [not fresh] * 3)
                frontend.assert_not_called()
                publish.assert_not_called()
                deploy.assert_not_called()
                if fresh:
                    latest.assert_not_called()


if __name__ == '__main__':
    unittest.main()
