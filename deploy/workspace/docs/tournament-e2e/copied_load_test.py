"""Container permission and startup preflight checks; Docker calls are mocked."""
import copy
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

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


if __name__ == '__main__':
    unittest.main()
