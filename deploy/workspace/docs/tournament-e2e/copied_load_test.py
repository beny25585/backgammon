"""Container permission and startup preflight checks; Docker calls are mocked."""
import copy
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import copied_load as load


class CopiedLoadPreflightTests(unittest.TestCase):
    def test_listener_api_role_and_session_are_checked(self):
        session = {'identity': {'session_id': 'a' * 32}}
        server = SimpleNamespace(HOST='test.invalid', ORIGIN='https://test.invalid:18443',
            run=Mock(side_effect=[json.dumps({'kind': kind, 'schema_version': 1,
                'session_id': 'a' * 32}) for kind in ('game', 'tournaments')]))
        def require(value, message):
            if not value:
                raise ValueError(message)
        server.require = require
        load.check_api_roles(server, session)
        self.assertEqual(server.run.call_count, 2)
        for change in ({'kind': 'tournaments'}, {'session_id': 'b' * 32}, {'schema_version': 2}):
            server.run = Mock(return_value=json.dumps(
                dict(kind='game', schema_version=1, session_id='a' * 32) | change))
            with self.assertRaisesRegex(ValueError, 'role differs'):
                load.check_api_roles(server, session)

    def fixture(self, directory):
        root = Path(directory)
        state, tools = root / 'state', root / 'tools'
        state.mkdir()
        tools.mkdir()
        volumes = []
        for name in sorted(load.CONTAINER_CODE):
            file = tools / name
            file.write_text('# published source\n')
            file.chmod(0o600)
            volumes.append({'type': 'bind', 'source': str(file),
                            'target': '/opt/e2e/' + name, 'read_only': True})
        secret = state / 'session.json'
        secret.write_text('{"admin": "private"}')
        secret.chmod(0o600)
        volumes.append({'type': 'bind', 'source': str(secret),
                        'target': '/opt/e2e/session.json', 'read_only': True})
        overlay = {'services': {'game-api': {'volumes': volumes},
                                'tournaments-api': {'volumes': copy.deepcopy(volumes)}}}
        (state / 'compose.e2e.json').write_text(json.dumps(overlay))
        server = SimpleNamespace(run=Mock())
        def require(value, message):
            if not value:
                raise ValueError(message)
        server.require = require
        return state, tools, secret, overlay, server

    def test_permission_command_only_targets_unique_published_python_helpers(self):
        with TemporaryDirectory() as directory:
            state, tools, secret, _, server = self.fixture(directory)
            before = {file: file.read_bytes() for file in tools.iterdir()}
            secret_mode = secret.stat().st_mode
            load.prepare_container_code(server, state, tools)
            server.run.assert_called_once_with(
                ['sudo', 'chmod', '0644', '--', *sorted(before)])
            self.assertEqual({file: file.read_bytes() for file in before}, before)
            self.assertEqual(secret.read_text(), '{"admin": "private"}')
            self.assertEqual(secret.stat().st_mode, secret_mode)

    def test_unsafe_code_mount_is_rejected_before_any_permission_change(self):
        mutations = (
            {'read_only': False}, {'type': 'volume'},
            {'source': '/outside/rehearsal_app.py'},
            {'target': '/opt/e2e/secrets.py'},
            {'target': '/opt/e2e/extra/rehearsal_app.py'},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation), TemporaryDirectory() as directory:
                state, tools, _, overlay, server = self.fixture(directory)
                overlay['services']['game-api']['volumes'][0].update(mutation)
                (state / 'compose.e2e.json').write_text(json.dumps(overlay))
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    load.prepare_container_code(server, state, tools)
                server.run.assert_not_called()

    def test_missing_code_file_is_rejected_before_permissions_change(self):
        with TemporaryDirectory() as directory:
            state, tools, _, _, server = self.fixture(directory)
            (tools / 'rehearsal_settings.py').unlink()
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                load.prepare_container_code(server, state, tools)
            server.run.assert_not_called()

    def test_symlink_code_file_is_rejected_before_permissions_change(self):
        with TemporaryDirectory() as directory:
            state, tools, secret, _, server = self.fixture(directory)
            file = tools / 'rehearsal_settings.py'
            file.unlink()
            try:
                file.symlink_to(secret)
            except OSError as error:
                self.skipTest('File symlinks unavailable: ' + str(error))
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                load.prepare_container_code(server, state, tools)
            server.run.assert_not_called()

    def test_startup_preflight_uses_real_entrypoint_without_recreating_services(self):
        server = SimpleNamespace(compose=Mock())
        args, state = object(), Path('/state')
        load.preflight_api_startup(server, args, state)
        self.assertEqual(server.compose.call_count, 2)
        for call, service in zip(server.compose.call_args_list, ('game-api', 'tournaments-api')):
            self.assertEqual(call.args, (args, state, 'run', '-T', '--rm', '--no-deps',
                '--pull', 'never', '--entrypoint', 'python', service,
                '/opt/docker/runtime_env.py', 'python', '-c', load.STARTUP_CHECK))
        self.assertIn("call_command('migrate', check=True", load.STARTUP_CHECK)
        self.assertIn('import rehearsal_asgi', load.STARTUP_CHECK)

    def test_startup_failure_propagates_and_stops_before_next_service(self):
        failure = subprocess.CalledProcessError(1, ['docker', 'compose', 'run'])
        server = SimpleNamespace(compose=Mock(side_effect=failure))
        with self.assertRaises(subprocess.CalledProcessError):
            load.preflight_api_startup(server, object(), Path('/state'))
        self.assertEqual(server.compose.call_count, 1)


class CopiedLoadRoutingRestorationTests(unittest.TestCase):
    def fixture(self, directory, swapped=True):
        state = Path(directory)
        identity = {'session_id': 'a' * 32}
        prefixes = ('/backgammon/api/', '/tournaments-api/', '/backgammon/', '/tournaments/', '/tournaments-admin/')
        services = ('game-api', 'tournaments-api', 'game-frontend', 'tournaments-frontend', 'admin-frontend')
        before = {name: f'172.22.0.{index + 2}:{8000 if index < 2 else 80}' for index, name in enumerate(services)}
        after = dict(before)
        if swapped:
            after['game-api'], after['tournaments-api'] = before['tournaments-api'], before['game-api']
        original = '# Session ' + identity['session_id'] + '\nserver {\nlisten 18443 ssl;\n' + '\n'.join(
            'location ' + prefix + ' { proxy_pass http://' + before[name] + '/; }'
            for name, prefix in zip(services, prefixes)) + '\n}\n'
        candidate = state / 'nginx.candidate.conf'
        candidate.write_text(original)
        server = SimpleNamespace(CONF=state / 'active.conf', run=Mock(return_value=original),
            discover_upstreams=Mock(return_value=after), check_listener=Mock(), write=Mock())
        def require(value, message):
            if not value:
                raise ValueError(message)
        server.require = require
        return state, {'identity': identity}, candidate, original, after, server

    def test_swapped_roles_are_refreshed_before_listener_and_api_checks(self):
        with TemporaryDirectory() as directory:
            state, session, candidate, _, after, server = self.fixture(directory)
            with patch.object(load, 'check_api_roles') as check:
                result = load.refresh_restored_listener(server, state, session)
            text = candidate.read_text()
            self.assertIn('location /backgammon/api/ { proxy_pass http://' + after['game-api'], text)
            self.assertIn('location /tournaments-api/ { proxy_pass http://' + after['tournaments-api'], text)
            self.assertEqual(result, {'upstreamsChanged': True, 'apiRolesVerified': True})
            server.check_listener.assert_called_once_with(session)
            check.assert_called_once_with(server, session)

    def test_unchanged_addresses_are_verified_without_install_or_reload(self):
        with TemporaryDirectory() as directory:
            state, session, candidate, original, _, server = self.fixture(directory, swapped=False)
            with patch.object(load, 'check_api_roles') as check:
                self.assertFalse(load.refresh_restored_listener(server, state, session)['upstreamsChanged'])
            server.run.assert_called_once_with(['sudo', 'cat', server.CONF], capture=True)
            server.write.assert_not_called()
            check.assert_called_once()
            self.assertEqual(candidate.read_text(), original)

    def test_independent_listener_change_is_rejected_before_install(self):
        with TemporaryDirectory() as directory:
            state, session, candidate, _, _, server = self.fixture(directory)
            candidate.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'changed during cleanup'):
                load.refresh_restored_listener(server, state, session)
            self.assertEqual(server.run.call_count, 1)
            server.write.assert_not_called()

    def test_failed_role_check_restores_saved_listener_and_propagates_failure(self):
        with TemporaryDirectory() as directory:
            state, session, candidate, original, _, server = self.fixture(directory)
            with patch.object(load, 'check_api_roles', side_effect=ValueError('role mismatch')):
                with self.assertRaisesRegex(ValueError, 'role mismatch'):
                    load.refresh_restored_listener(server, state, session)
            self.assertEqual(candidate.read_text(), original)
            installed = [call.args[0] for call in server.run.call_args_list if 'install' in call.args[0]]
            self.assertEqual(len(installed), 2)
            self.assertTrue(installed[1][-2].name.startswith('routing-after-restart-'))

    def test_additional_unobserved_proxy_is_rejected_before_install(self):
        for destination in ('http://172.22.0.99:8000/', 'https://outside.invalid/'):
            with TemporaryDirectory() as directory:
                state, session, candidate, original, _, server = self.fixture(directory)
                original = original.replace('listen 18443 ssl;',
                    'listen 18443 ssl;\nlocation /unexpected/ { proxy_pass ' + destination + '; }')
                candidate.write_text(original)
                server.run.return_value = original
                with self.assertRaisesRegex(ValueError, 'Unexpected prepared proxy'):
                    load.refresh_restored_listener(server, state, session)
                self.assertEqual(server.run.call_count, 1)
                server.discover_upstreams.assert_not_called()


if __name__ == '__main__':
    unittest.main()
