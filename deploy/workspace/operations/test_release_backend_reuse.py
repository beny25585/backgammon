"""Backend receipt reuse regressions; all services and images are private fakes."""
import argparse
import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_pipeline as release
from test_release_workflow import TOOLS, emit, manifest


TEST_IMAGES = {'postgres': 'sha256:' + 'e' * 64, 'redis': 'sha256:' + 'f' * 64}
ENGINE = '27.3.1 amd64'


def image(number=1):
    """Model Docker's runtime fields, including metadata changed by release tags."""
    return {'Id': 'sha256:' + f'{number:064x}', 'Os': 'linux', 'Architecture': 'amd64',
            'RootFS': {'Type': 'layers', 'Layers': ['sha256:' + 'b' * 64, 'sha256:' + 'c' * 64]},
            'Config': {'Env': ['PATH=/usr/local/bin', 'APP_MODE=test'],
                       'Cmd': ['python', 'manage.py', 'runserver'], 'Entrypoint': None,
                       'User': 'app', 'WorkingDir': '/app',
                       'Labels': {'io.backgammon.release': manifest(number)['release_id'],
                                  'org.opencontainers.image.revision': 'a' * 40,
                                  'org.example.runtime': 'stable'}}}


def inspections():
    return {kind: image(number) for number, kind in enumerate(release.IMAGES, 1)}


def backend_stages(kind='game'):
    stages = ['test-network', 'test-postgres', 'test-redis', kind + '-migrations']
    if kind == 'game':
        stages += ['test-dice', 'test-dice-ready']
    return stages + [kind + '-tests']


class BackendInputTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(release, 'tool_hashes', return_value=TOOLS))
        self.enterContext(patch.object(release, 'capture', side_effect=AssertionError('Unexpected external tool')))

    def test_release_labels_and_image_id_do_not_change_runtime_identity(self):
        original = image()
        rebuilt = copy.deepcopy(original)
        rebuilt['Id'] = 'sha256:' + 'd' * 64
        rebuilt['Config']['Labels'].update({'io.backgammon.release': manifest(2)['release_id'],
                                            'org.opencontainers.image.revision': 'd' * 40})
        before = copy.deepcopy(original)
        fingerprint = release.image_runtime_fingerprint(original)
        self.assertRegex(fingerprint, r'^[a-f0-9]{64}$')
        self.assertEqual(fingerprint, release.image_runtime_fingerprint(rebuilt))
        self.assertEqual(original, before, 'Fingerprinting must not remove labels from the inspected image')

    def test_every_runtime_config_field_and_nonrelease_label_matters(self):
        changes = ({'Env': ['PATH=/usr/local/bin', 'APP_MODE=production']},
                   {'Cmd': ['python', 'other.py']}, {'Entrypoint': ['/entrypoint.sh']},
                   {'User': 'root'}, {'WorkingDir': '/other'},
                   {'Labels': {'org.example.runtime': 'changed'}},
                   {'Healthcheck': {'Test': ['CMD', 'false']}}, {'StopSignal': 'SIGINT'},
                   {'ExposedPorts': {'9000/tcp': {}}}, {'Volumes': {'/data': {}}})
        baseline = release.image_runtime_fingerprint(image())
        for change in changes:
            with self.subTest(field=next(iter(change))):
                modified = image()
                modified['Config'].update(change)
                self.assertNotEqual(baseline, release.image_runtime_fingerprint(modified))

    def test_root_filesystem_platform_and_variant_matter(self):
        changes = ({'RootFS': {'Type': 'layers', 'Layers': ['sha256:' + 'd' * 64]}},
                   {'Os': 'windows'}, {'Architecture': 'arm64'}, {'Variant': 'v8'})
        baseline = release.image_runtime_fingerprint(image())
        for change in changes:
            with self.subTest(field=next(iter(change))):
                self.assertNotEqual(baseline, release.image_runtime_fingerprint({**image(), **change}))

    def test_incomplete_or_mutable_image_identity_is_refused(self):
        changes = ({'Id': 'runtime:latest'}, {'RootFS': {}}, {'Config': None},
                   {'Architecture': ''}, {'Os': ''},
                   {'RootFS': {'Type': 'layers', 'Layers': ['mutable-layer']}})
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(RuntimeError):
                    release.image_runtime_fingerprint({**image(), **change})

    def test_component_dependencies_exclude_all_frontends(self):
        expected = {'game': ('game', 'dice'), 'tournaments': ('tournaments',), 'analysis': ('analysis',)}
        self.assertEqual(release.BACKEND_IMAGE_DEPENDENCIES, expected)
        original = inspections()
        changed = copy.deepcopy(original)
        for kind in changed:
            if 'frontend' in kind:
                changed[kind] = image(99)
                changed[kind]['Config']['Env'] = ['FRONTEND=changed']
        for kind in release.BACKENDS:
            with self.subTest(kind=kind):
                self.assertEqual(release.backend_phase_inputs(kind, original, ENGINE, TEST_IMAGES),
                                 release.backend_phase_inputs(kind, changed, ENGINE, TEST_IMAGES))

    def test_dice_runtime_change_invalidates_only_game(self):
        original = inspections()
        changed = copy.deepcopy(original)
        changed['dice']['RootFS']['Layers'].append('sha256:' + 'd' * 64)
        for kind in release.BACKENDS:
            with self.subTest(kind=kind):
                left = release.backend_phase_inputs(kind, original, ENGINE, TEST_IMAGES)
                right = release.backend_phase_inputs(kind, changed, ENGINE, TEST_IMAGES)
                self.assertEqual(left == right, kind != 'game')

    def test_backend_runtime_change_invalidates_its_own_component(self):
        original = inspections()
        for changed_kind in release.BACKENDS:
            changed = copy.deepcopy(original)
            changed[changed_kind]['Config']['Env'].append('NEW_FEATURE=true')
            for checked_kind in release.BACKENDS:
                with self.subTest(changed=changed_kind, checked=checked_kind):
                    before = release.backend_phase_inputs(checked_kind, original, ENGINE, TEST_IMAGES)
                    after = release.backend_phase_inputs(checked_kind, changed, ENGINE, TEST_IMAGES)
                    self.assertEqual(before == after, checked_kind != changed_kind)

    def test_test_services_engine_and_settings_are_part_of_inputs(self):
        original = inspections()
        for kind in release.BACKENDS:
            baseline = release.backend_phase_inputs(kind, original, ENGINE, TEST_IMAGES)
            for service in TEST_IMAGES:
                with self.subTest(kind=kind, service=service):
                    changed = {**TEST_IMAGES, service: 'sha256:' + 'd' * 64}
                    self.assertNotEqual(baseline, release.backend_phase_inputs(kind, original, ENGINE, changed))
            self.assertNotEqual(baseline, release.backend_phase_inputs(kind, original, '28.0 amd64', TEST_IMAGES))
            with patch.object(release, 'tool_hashes', return_value={**TOOLS, 'release_test_settings.py': '3' * 64}):
                self.assertNotEqual(baseline, release.backend_phase_inputs(kind, original, ENGINE, TEST_IMAGES))


class BackendReceiptReuseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.enterContext(patch.object(release, 'tool_hashes', return_value=TOOLS))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.capture = self.enterContext(patch.object(release, 'capture', side_effect=AssertionError('Unexpected external tool')))
        self.enterContext(patch.object(release.subprocess, 'run', side_effect=AssertionError('Unexpected process')))
        self.enterContext(patch.object(release.subprocess, 'Popen', side_effect=AssertionError('Unexpected process')))
        self.inputs = release.backend_phase_inputs('game', inspections(), ENGINE, TEST_IMAGES)

    def progress(self, number, *, scope='local', changed_sources=False, source_revision=None, fresh=False, previous=None):
        value = manifest(number)
        value['sources'] = copy.deepcopy(value['sources'])
        if changed_sources or source_revision:
            for source in value['sources'].values():
                source['revision'] = source_revision or 'd' * 40
        value['fresh'] = fresh
        runner = release.Runner(self.root / value['release_id'])
        release.save(runner.directory / 'status.json', dict(value, stage='failed', published={},
                     production_changed=False, migrations_started=False, public_writes_opened=False))
        return release.ReleaseProgress(runner, value, scope, previous)

    def complete(self, progress, *, kind='game', inputs=None):
        stages = backend_stages(kind)
        def action():
            emit(progress.runner, stages)
            return {'checked': kind}
        return progress.run('backend-' + kind, stages, action,
                            inputs=self.inputs if inputs is None else inputs, reuse_backend=True)

    def run_phase(self, progress, *, inputs=None, reuse=True):
        action = Mock(side_effect=lambda: emit(progress.runner, backend_stages()))
        result = progress.run('backend-game', backend_stages(), action,
                              inputs=self.inputs if inputs is None else inputs, reuse_backend=reuse)
        return action, result

    def rewrite(self, progress, filename, edit):
        path = progress.runner.directory / filename
        value = json.loads(path.read_text(encoding='utf-8'))
        edit(value)
        release.save(path, value)

    def test_matching_runtime_reuses_original_evidence_after_all_source_revisions_change(self):
        old = self.progress(1)
        self.complete(old)
        before = {path.name: path.read_bytes() for path in old.runner.directory.iterdir() if path.is_file()}
        new = self.progress(2, changed_sources=True)
        action, result = self.run_phase(new)
        action.assert_not_called()
        self.assertEqual(result, {'checked': 'game'})
        self.assertEqual(new.value['phases']['backend-game']['origin_release'], old.runner.directory.name)
        self.assertTrue(all('reused_from' in row for row in new.runner.timings))
        self.assertEqual({path.name: path.read_bytes() for path in old.runner.directory.iterdir() if path.is_file()}, before)
        self.capture.assert_not_called()

    def test_reuse_chain_preserves_original_origin_after_further_source_changes(self):
        old = self.progress(1)
        self.complete(old)
        intermediate = self.progress(2, changed_sources=True)
        self.run_phase(intermediate)[0].assert_not_called()
        latest = self.progress(3, source_revision='e' * 40)
        self.run_phase(latest)[0].assert_not_called()
        for progress in (intermediate, latest):
            self.assertEqual(progress.value['phases']['backend-game']['origin_release'], old.runner.directory.name)
            self.assertTrue(all(Path(row['reused_from']).parent == old.runner.directory
                                for row in progress.runner.timings))

    def test_same_source_continuation_cannot_use_copy_when_original_evidence_is_missing_or_tampered(self):
        for number, case in enumerate(('missing', 'tampered'), 1):
            with self.subTest(case=case):
                inputs = {**self.inputs, 'fixture': case}
                old = self.progress(number * 3 - 2)
                self.complete(old, inputs=inputs)
                intermediate = self.progress(number * 3 - 1, changed_sources=True)
                self.run_phase(intermediate, inputs=inputs)[0].assert_not_called()
                if case == 'missing':
                    (old.runner.directory / 'progress.json').unlink()
                else:
                    (old.runner.directory / '001-test-network.log').write_text('tampered original', encoding='utf-8')
                previous = intermediate.runner.directory, copy.deepcopy(intermediate.value)
                latest = self.progress(number * 3, changed_sources=True, previous=previous)
                if case == 'missing':
                    self.run_phase(latest, inputs=inputs)[0].assert_called_once()
                    self.assertEqual(latest.value['phases']['backend-game']['origin_release'], latest.runner.directory.name)
                else:
                    action = Mock()
                    with self.assertRaisesRegex(RuntimeError, 'evidence changed'):
                        latest.run('backend-game', backend_stages(), action, inputs=inputs, reuse_backend=True)
                    action.assert_not_called()
                    self.assertNotIn('backend-game', latest.value['phases'])

    def test_cache_diagnostics_identify_hit_and_miss_without_runtime_environment_values(self):
        actual = inspections()
        private_value = 'private-runtime-value-for-unit-test'
        actual['game']['Config']['Env'].append('PRIVATE_TOKEN=' + private_value)
        inputs = release.backend_phase_inputs('game', actual, ENGINE, TEST_IMAGES)
        old = self.progress(1)
        self.complete(old, inputs=inputs)
        hit = self.progress(2, changed_sources=True)
        hit_output = io.StringIO()
        with contextlib.redirect_stdout(hit_output):
            self.run_phase(hit, inputs=inputs)[0].assert_not_called()
        self.assertIn('CACHE HIT backend-game', hit_output.getvalue())
        self.assertIn(old.runner.directory.name, hit_output.getvalue())

        actual['game']['Config']['Env'].append('NEW_MODE=enabled')
        changed_inputs = release.backend_phase_inputs('game', actual, ENGINE, TEST_IMAGES)
        miss = self.progress(3, source_revision='e' * 40)
        miss_output = io.StringIO()
        with contextlib.redirect_stdout(miss_output):
            self.run_phase(miss, inputs=changed_inputs)[0].assert_called_once()
        self.assertIn('CACHE MISS backend-game', miss_output.getvalue())
        for output in (hit_output.getvalue(), miss_output.getvalue(),
                       json.dumps(old.value), json.dumps(hit.value), json.dumps(miss.value)):
            self.assertNotIn(private_value, output)
            self.assertNotIn('NEW_MODE=enabled', output)

    def test_local_and_server_evidence_are_isolated_in_both_directions(self):
        for number, scopes in enumerate((('local', 'server'), ('server', 'local')), 1):
            with self.subTest(scopes=scopes):
                inputs = {**self.inputs, 'fixture': number}
                old = self.progress(number * 2 - 1, scope=scopes[0])
                self.complete(old, inputs=inputs)
                new = self.progress(number * 2, scope=scopes[1], changed_sources=True)
                self.run_phase(new, inputs=inputs)[0].assert_called_once()

    def test_every_backend_reuses_its_own_original_receipt(self):
        for number, kind in enumerate(release.BACKENDS, 1):
            with self.subTest(kind=kind):
                inputs = release.backend_phase_inputs(kind, inspections(), ENGINE, TEST_IMAGES)
                old = self.progress(number * 2 - 1)
                self.complete(old, kind=kind, inputs=inputs)
                new = self.progress(number * 2, changed_sources=True)
                action = Mock()
                result = new.run('backend-' + kind, backend_stages(kind), action,
                                 inputs=inputs, reuse_backend=True)
                action.assert_not_called()
                self.assertEqual(result, {'checked': kind})

    def test_completed_server_deployment_can_supply_original_test_evidence(self):
        old = self.progress(1, scope='server')
        self.complete(old)
        def production_status(value):
            value.pop('schema_version')  # Production.status does not carry the upload envelope.
            value.update(stage='production_open', production_changed=True,
                         migrations_started=True, public_writes_opened=True)
        self.rewrite(old, 'status.json', production_status)
        new = self.progress(2, scope='server', changed_sources=True)
        self.run_phase(new)[0].assert_not_called()

    def test_server_receipt_awaiting_manual_recovery_is_not_reused(self):
        old = self.progress(1, scope='server')
        self.complete(old)
        self.rewrite(old, 'status.json', lambda value: value.update(stage='maintenance_requires_attention',
                     production_changed=True, migrations_started=True, public_writes_opened=False))
        new = self.progress(2, scope='server', changed_sources=True)
        self.run_phase(new)[0].assert_called_once()

    def test_server_transition_or_recovery_stage_is_not_reused_even_with_all_change_flags_false(self):
        for number, stage in enumerate(('entering_maintenance', 'recovery_requires_attention'), 1):
            with self.subTest(stage=stage):
                inputs = {**self.inputs, 'fixture': stage}
                old = self.progress(number * 2 - 1, scope='server')
                self.complete(old, inputs=inputs)
                self.rewrite(old, 'status.json', lambda value: value.update(stage=stage))
                new = self.progress(number * 2, scope='server', changed_sources=True)
                self.run_phase(new, inputs=inputs)[0].assert_called_once()

    def test_changed_inputs_rerun_tests(self):
        old = self.progress(1)
        self.complete(old)
        new = self.progress(2, changed_sources=True)
        self.run_phase(new, inputs={**self.inputs, 'docker_engine': 'changed'})[0].assert_called_once()
        self.assertTrue(all('reused_from' not in row for row in new.runner.timings))

    def test_tool_or_workflow_changes_exclude_original_evidence(self):
        changes = [('workflow_version', -1)] + [('tools', {**TOOLS, tool: '4' * 64}) for tool in TOOLS]
        for number, (field, replacement) in enumerate(changes, 1):
            with self.subTest(field=field, replacement=replacement):
                inputs = {**self.inputs, 'fixture': number}
                old = self.progress(number * 2 - 1)
                self.complete(old, inputs=inputs)
                self.rewrite(old, 'progress.json', lambda value: value.update({field: replacement}))
                new = self.progress(number * 2, changed_sources=True)
                self.run_phase(new, inputs=inputs)[0].assert_called_once()

    def test_default_flag_does_not_enable_cross_release_backend_reuse(self):
        old = self.progress(1)
        self.complete(old)
        new = self.progress(2, changed_sources=True)
        action = Mock(side_effect=lambda: emit(new.runner, backend_stages()))
        new.run('backend-game', backend_stages(), action, inputs=self.inputs)
        action.assert_called_once()

    def test_fresh_refuses_backend_reuse_even_when_flag_is_true(self):
        old = self.progress(1)
        self.complete(old)
        new = self.progress(2, changed_sources=True, fresh=True)
        self.run_phase(new)[0].assert_called_once()

    def test_only_original_receipts_are_cross_release_candidates(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite(old, 'progress.json', lambda value: value['phases']['backend-game'].update(
                     origin_release=manifest(9)['release_id']))
        new = self.progress(2, changed_sources=True)
        self.run_phase(new)[0].assert_called_once()

    def test_missing_runtime_input_proof_reruns_instead_of_reusing_legacy_receipt(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite(old, 'progress.json', lambda value: value['phases']['backend-game'].pop('input_details'))
        new = self.progress(2, changed_sources=True)
        self.run_phase(new)[0].assert_called_once()

    def test_tampered_runtime_input_proof_is_rejected_before_action(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite(old, 'progress.json', lambda value: value['phases']['backend-game']['input_details'].update(
                     docker_engine='changed'))
        new = self.progress(2, changed_sources=True)
        action = Mock()
        with self.assertRaises(RuntimeError):
            new.run('backend-game', backend_stages(), action, inputs=self.inputs, reuse_backend=True)
        action.assert_not_called()

    def test_incomplete_and_tampered_evidence_is_rejected_before_action(self):
        cases = ('incomplete', 'log', 'result', 'unsafe-path')
        for number, case in enumerate(cases, 1):
            with self.subTest(case=case):
                inputs = {**self.inputs, 'fixture': number}
                old = self.progress(number * 2 - 1)
                self.complete(old, inputs=inputs)
                if case == 'log':
                    (old.runner.directory / '001-test-network.log').write_text('tampered', encoding='utf-8')
                else:
                    def edit(value):
                        phase = value['phases']['backend-game']
                        if case == 'incomplete':
                            phase['logs'].pop()
                        elif case == 'result':
                            phase['result'] = 'tampered'
                        else:
                            phase['logs'][0]['file'] = '../../outside.log'
                    self.rewrite(old, 'progress.json', edit)
                new = self.progress(number * 2, changed_sources=True)
                action = Mock()
                with self.assertRaisesRegex(RuntimeError, 'Incomplete|evidence changed|result changed|Unsafe'):
                    new.run('backend-game', backend_stages(), action, inputs=inputs, reuse_backend=True)
                action.assert_not_called()
                self.assertNotIn('backend-game', new.value['phases'])

    def test_invalid_source_manifest_is_rejected(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite(old, 'status.json', lambda value: value['sources'].pop('backgammon-analysis-service'))
        new = self.progress(2, changed_sources=True)
        action = Mock()
        with self.assertRaisesRegex(RuntimeError, 'source set'):
            new.run('backend-game', backend_stages(), action, inputs=self.inputs, reuse_backend=True)
        action.assert_not_called()

    def test_status_and_progress_must_agree_on_original_sources(self):
        old = self.progress(1)
        self.complete(old)
        self.rewrite(old, 'progress.json', lambda value: value['sources']['Backgammon Game'].update(revision='b' * 40))
        new = self.progress(2, changed_sources=True)
        action = Mock()
        with self.assertRaisesRegex(RuntimeError, 'sources differ'):
            new.run('backend-game', backend_stages(), action, inputs=self.inputs, reuse_backend=True)
        action.assert_not_called()

    def test_status_and_progress_must_agree_on_workflow_and_tools(self):
        for number, (field, value) in enumerate((('workflow_version', -1), ('tools', {'changed': 'digest'})), 1):
            with self.subTest(field=field):
                inputs = {**self.inputs, 'fixture': field}
                old = self.progress(number * 2 - 1)
                self.complete(old, inputs=inputs)
                self.rewrite(old, 'status.json', lambda status: status.update({field: value}))
                new = self.progress(number * 2, changed_sources=True)
                action = Mock()
                with self.assertRaisesRegex(RuntimeError, 'tool inputs differ'):
                    new.run('backend-game', backend_stages(), action, inputs=inputs, reuse_backend=True)
                action.assert_not_called()

    def test_failed_suite_never_records_a_backend_phase(self):
        progress = self.progress(1)
        def fail():
            emit(progress.runner, backend_stages()[:-1])
            raise RuntimeError('fixture suite failed')
        with self.assertRaisesRegex(RuntimeError, 'fixture suite failed'):
            progress.run('backend-game', backend_stages(), fail, inputs=self.inputs, reuse_backend=True)
        saved = json.loads((progress.runner.directory / 'progress.json').read_text(encoding='utf-8'))
        self.assertNotIn('backend-game', saved['phases'])

    def test_backend_flag_does_not_allow_image_frontend_or_other_phases(self):
        for number, name in enumerate(('images', 'frontend-game', 'dice-tests', 'release-tool-tests', 'backend-unknown'), 1):
            with self.subTest(name=name):
                progress = self.progress(number)
                action = Mock()
                with self.assertRaisesRegex(RuntimeError, 'backend'):
                    progress.run(name, ['fixture'], action, inputs=self.inputs, reuse_backend=True)
                action.assert_not_called()

    def test_backend_flag_requires_local_or_server_scope(self):
        progress = self.progress(1, scope='unknown')
        action = Mock()
        with self.assertRaisesRegex(RuntimeError, 'backend|scope'):
            progress.run('backend-game', backend_stages(), action, inputs=self.inputs, reuse_backend=True)
        action.assert_not_called()

    def test_frontend_and_backend_flags_cannot_be_combined(self):
        progress = self.progress(1)
        action = Mock()
        with self.assertRaises(RuntimeError):
            progress.run('backend-game', backend_stages(), action, inputs=self.inputs,
                         reuse_backend=True, reuse_frontend=True)
        action.assert_not_called()


class BackendCallerTests(unittest.TestCase):
    def test_inspected_image_id_mismatch_is_refused_before_any_backend_phase(self):
        with tempfile.TemporaryDirectory() as folder:
            actual = inspections()
            images = {kind: item['Id'] for kind, item in actual.items()}
            by_id = {item['Id']: item for item in actual.values()}
            by_id[images['game']]['Id'] = 'sha256:' + 'd' * 64
            runner = release.Runner(Path(folder))
            progress = Mock(fresh=False)
            def capture(command, cwd=None):
                if 'version' in command:
                    return ENGINE.encode()
                tag = command[-1]
                if tag in ('postgres:16', 'redis:7-alpine'):
                    service = 'postgres' if tag == 'postgres:16' else 'redis'
                    return json.dumps([{'Id': TEST_IMAGES[service]}]).encode()
                return json.dumps([by_id[tag]]).encode()
            with patch.object(release, 'capture', side_effect=capture), \
                 patch.object(release, 'backend_checks') as checks, \
                 patch.object(runner, 'run', side_effect=AssertionError('Unexpected real command')):
                with self.assertRaisesRegex(RuntimeError, 'runtime image identity differs'):
                    release.checked_backends(Path(folder), images, runner, progress)
            progress.run.assert_not_called()
            checks.assert_not_called()

    def test_checked_backends_honors_fresh_for_every_component_without_running_actions(self):
        with tempfile.TemporaryDirectory() as folder:
            for fresh in (False, True):
                with self.subTest(fresh=fresh):
                    runner = release.Runner(Path(folder) / str(fresh))
                    progress = Mock(fresh=fresh)
                    actual = inspections()
                    images = {kind: item['Id'] for kind, item in actual.items()}
                    by_id = {item['Id']: item for item in actual.values()}
                    def capture(command, cwd=None):
                        if 'version' in command:
                            return ENGINE.encode()
                        tag = command[-1]
                        if tag in ('postgres:16', 'redis:7-alpine'):
                            service = 'postgres' if tag == 'postgres:16' else 'redis'
                            return json.dumps([{'Id': TEST_IMAGES[service]}]).encode()
                        return json.dumps([by_id[tag]]).encode()
                    with patch.object(release, 'capture', side_effect=capture), \
                         patch.object(release, 'tool_hashes', return_value=TOOLS), \
                         patch.object(release, 'backend_checks') as checks, \
                         patch.object(runner, 'run', side_effect=AssertionError('Unexpected real command')):
                        release.checked_backends(Path(folder), images, runner, progress)
                    self.assertEqual([call.args[0] for call in progress.run.call_args_list],
                                     ['backend-' + kind for kind in release.BACKENDS])
                    self.assertEqual([call.kwargs.get('reuse_backend') for call in progress.run.call_args_list],
                                     [not fresh] * len(release.BACKENDS))
                    checks.assert_not_called()

    def test_local_caller_transmits_fresh_into_backend_progress(self):
        for fresh in (False, True):
            with self.subTest(fresh=fresh), tempfile.TemporaryDirectory() as folder:
                args = argparse.Namespace(root=Path(folder), resume_from=None, fresh=fresh,
                                          checks_only=True, preflight_only=False)
                with patch.object(release, 'local_environment', return_value=manifest(1)['sources']), \
                     patch.object(release, 'tool_hashes', return_value=TOOLS), \
                     patch.object(release, 'latest_progress', return_value=None), \
                     patch.object(release, 'capture', return_value=b'fixture-runtime'), \
                     patch.object(release.shutil, 'which', return_value='fixture-tool'), \
                     patch.object(release, 'frontend_phase_inputs', return_value={}), \
                     patch.object(release.ReleaseProgress, 'run'), \
                     patch.object(release, 'assert_sources'), patch.object(release, 'exported_workspace'), \
                     patch.object(release, 'checked_images'), patch.object(release, 'checked_backends') as checked, \
                     patch.object(release, 'server_readiness', side_effect=AssertionError('Unexpected server access')), \
                     patch.object(release, 'publish_exact', side_effect=AssertionError('Unexpected Git publication')), \
                     patch.object(release, 'upload_and_deploy', side_effect=AssertionError('Unexpected deployment')), \
                     contextlib.redirect_stdout(io.StringIO()):
                    release.automatic_local_main(args)
                checked.assert_called_once()
                self.assertIs(checked.call_args.args[3].fresh, fresh)

    def test_server_manifest_transmits_fresh_into_backend_progress_with_all_actions_mocked(self):
        for fresh in (False, True):
            with self.subTest(fresh=fresh), tempfile.TemporaryDirectory() as folder:
                value = manifest(1)
                value['fresh'] = fresh
                production = Mock(status={})
                fake_fcntl = Mock(LOCK_EX=1, LOCK_NB=2)
                with patch.dict(sys.modules, {'fcntl': fake_fcntl}), \
                     patch.object(release, 'SERVER_ROOT', Path(folder)), \
                     patch.object(release, 'tool_hashes', return_value=TOOLS), \
                     patch.object(release, 'Production', return_value=production), \
                     patch.object(release, 'latest_progress', return_value=None) as latest, \
                     patch.object(release, 'source_inventory', return_value=value['sources']), \
                     patch.object(release, 'git', return_value='a' * 40), \
                     patch.object(release.Runner, 'run'), \
                     patch.object(release.subprocess, 'run'), \
                     patch.object(release, 'capture', side_effect=AssertionError('Unexpected external tool')), \
                     patch.object(release, 'exported_workspace'), \
                     patch.object(release, 'checked_images'), \
                     patch.object(release, 'checked_backends') as checked, \
                     patch.object(release, 'backend_checks', side_effect=AssertionError('Unexpected legacy test path')), \
                     contextlib.redirect_stdout(io.StringIO()):
                    release.server_main(value)
                checked.assert_called_once()
                self.assertIs(checked.call_args.args[3].fresh, fresh)
                self.assertIs(checked.call_args.kwargs['sudo'], True)
                production.failed.assert_not_called()
                if fresh:
                    latest.assert_not_called()
                else:
                    latest.assert_called_once()


if __name__ == '__main__':
    unittest.main()
