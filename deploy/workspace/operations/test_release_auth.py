"""Password-once regressions with fake credentials, processes and pipe peers only."""
import ast
import base64
import contextlib
import getpass
import io
import os
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import warnings
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import release_auth as auth
import release_pipeline as release

TARGET = 'deployer@example.invalid'
PASSWORD = 'test-only-סיסמה-$()`&%'


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        windows = Mock(wraps=os)
        windows.name = 'nt'
        windows.environ = os.environ
        self.enterContext(patch.object(auth, 'os', windows))
        self.prompt = self.enterContext(patch.object(auth.getpass, 'getpass', return_value=PASSWORD))
        self.broker = Mock(address=r'\\.\pipe\bg-release-test-only', owner_pid=321)
        self.factory = self.enterContext(patch.object(auth, '_WindowsBroker', return_value=self.broker))

    def credentials(self):
        credentials = auth.DeploymentAuthentication(TARGET)
        self.addCleanup(credentials.close)
        return credentials

    def test_one_prompt_and_child_only_environment_across_all_four_connections(self):
        before = dict(os.environ)
        credentials = self.credentials()
        commands = (["ssh", "-tt", TARGET, "readiness"],
                    ["ssh", "-tt", TARGET, "readiness"],
                    ["scp", "bundle.zip", TARGET + ":bundle.zip"],
                    ["ssh", "-tt", TARGET, "deployment"])
        for command in commands:
            with self.subTest(command=command[0]):
                argv, environment = credentials.prepare_command(command)
                self.assertEqual(environment['SSH_ASKPASS_REQUIRE'], 'force')
                self.assertEqual(environment['BG_RELEASE_AUTH_TARGET'], TARGET)
                self.assertIn('StrictHostKeyChecking=yes', ' '.join(map(str, argv)))
                self.assertIn('NumberOfPasswordPrompts=1', ' '.join(map(str, argv)))
                self.assertNotIn(PASSWORD, repr(argv))
                self.assertNotIn(PASSWORD, repr(environment))
                self.assertNotIn(base64.b64encode(PASSWORD.encode()).decode(), repr(environment))
        self.prompt.assert_called_once()
        self.assertEqual(dict(os.environ), before, 'Auth must not invalidate frontend environment fingerprints')

    def test_sudo_frame_round_trips_unicode_and_shell_metacharacters_without_argv(self):
        credentials = self.credentials()
        private_input = io.BytesIO()
        credentials.send_sudo_password(private_input)
        frame = private_input.getvalue()
        self.assertEqual(frame.count(b'\n'), 1)
        self.assertEqual(base64.b64decode(frame, validate=False).decode(), PASSWORD)

    def test_raw_and_wire_secret_are_redacted_and_retained_buffer_is_cleared(self):
        credentials = self.credentials()
        raw = PASSWORD.encode()
        wire = base64.b64encode(raw)
        redacted = credentials.redact(b'prefix ' + raw + b' ' + wire + b' suffix')
        self.assertNotIn(raw, redacted)
        self.assertNotIn(wire, redacted)
        retained = credentials._secret
        credentials.close()
        credentials.close()
        self.assertFalse(any(retained))
        self.broker.close.assert_called_once()

    def test_getpass_echo_fallback_never_starts_a_broker(self):
        def insecure_prompt(*args, **kwargs):
            warnings.warn('test-only terminal lacks echo control', getpass.GetPassWarning)
            return PASSWORD

        self.prompt.side_effect = insecure_prompt
        with self.assertRaises((RuntimeError, getpass.GetPassWarning)):
            auth.DeploymentAuthentication(TARGET)
        self.factory.assert_not_called()

    def test_askpass_rejects_confirmation_other_host_and_private_key_prompts(self):
        credentials = self.credentials()
        _, environment = credentials.prepare_command(['ssh', '-tt', TARGET, 'readiness'])
        with (patch.dict(os.environ, environment, clear=True),
              patch.object(auth, '_read_pipe_secret') as read):
            for prompt in ('Are you sure you want to continue connecting (yes/no)?',
                           "intruder@example.invalid's password: ",
                           'Enter passphrase for key id_ed25519:'):
                with self.subTest(prompt=prompt), contextlib.redirect_stderr(io.StringIO()):
                    self.assertNotEqual(auth._askpass(prompt), 0)
            with patch.dict(os.environ, {'SSH_ASKPASS_PROMPT': 'confirm'}):
                self.assertNotEqual(auth._askpass(TARGET + "'s password: "), 0)
            read.assert_not_called()

    def test_askpass_returns_secret_only_to_its_private_stdout_for_expected_target(self):
        credentials = self.credentials()
        _, environment = credentials.prepare_command(['ssh', '-tt', TARGET, 'readiness'])
        output = Mock(buffer=io.BytesIO())
        with (patch.dict(os.environ, environment, clear=True), patch.object(auth.sys, 'stdout', output),
              patch.object(auth, '_read_pipe_secret', return_value=PASSWORD.encode()) as read):
            self.assertEqual(auth._askpass(TARGET + "'s password: "), 0)
        self.assertEqual(output.buffer.getvalue().rstrip(b'\n'), PASSWORD.encode())
        read.assert_called_once()


class RunnerAuthenticationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.runner = release.Runner(self.directory)
        self.addCleanup(self.runner.close_authentication)
        self.credentials = Mock()
        self.credentials.prepare_command.side_effect = lambda args, env=None: (args, dict(env or {}))
        self.credentials.redact.side_effect = lambda line: line.replace(PASSWORD.encode(), b'[redacted]')
        self.factory = self.enterContext(patch.object(release, 'DeploymentAuthentication',
                                                     return_value=self.credentials))

    @staticmethod
    def process(output):
        process = Mock(pid=4321, stdout=io.BytesIO(output), stdin=io.BytesIO())
        process.wait.return_value = 0
        process.poll.return_value = 0
        return process

    def test_auth_is_reused_and_sudo_secret_waits_for_exact_echo_off_marker(self):
        marker = 'BG_RELEASE_SUDO_test_only_marker'
        observations = []
        processes = []

        def launch(*args, **kwargs):
            remote = args[0][0] == 'ssh'
            process = self.process((marker.encode() + b'\r\n' if remote else b'')
                                   + b'output ' + PASSWORD.encode() + b'\n')
            processes.append(process)
            self.assertEqual(kwargs['stdin'], release.subprocess.PIPE)
            return process

        def provide_secret(stream):
            observations.append(stream)
            self.credentials.authorize_process.assert_called_with(4321)

        self.credentials.send_sudo_password.side_effect = provide_secret
        with patch.object(release.subprocess, 'Popen', side_effect=launch), contextlib.redirect_stdout(io.StringIO()):
            for stage, command in (('ready-one', ['ssh', '-tt', release.SSH_TARGET, 'readiness']),
                                   ('ready-two', ['ssh', '-tt', release.SSH_TARGET, 'readiness']),
                                   ('upload', ['scp', 'bundle.zip', release.SSH_TARGET + ':bundle.zip']),
                                   ('deploy', ['ssh', '-tt', release.SSH_TARGET, 'deployment'])):
                self.runner.run(stage, command, sudo_marker=marker if command[0] == 'ssh' else None)
        self.factory.assert_called_once_with(release.SSH_TARGET)
        self.assertEqual(len(observations), 3)
        self.assertEqual(self.credentials.release_process.call_count, 4)
        for process in processes:
            self.assertTrue(process.stdin.closed)
        for path in self.directory.iterdir():
            self.assertNotIn(PASSWORD.encode(), path.read_bytes())
            self.assertNotIn(marker.encode(), path.read_bytes())

    def test_missing_marker_fails_without_sending_secret(self):
        process = self.process(b'ordinary output without echo-off acknowledgement\n')
        with (patch.object(release.subprocess, 'Popen', return_value=process),
              contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError)):
            self.runner.run('ready', ['ssh', '-tt', release.SSH_TARGET, 'readiness'],
                            sudo_marker='BG_RELEASE_SUDO_test_only_missing')
        self.credentials.send_sudo_password.assert_not_called()
        self.credentials.release_process.assert_called_once_with(4321)

    def test_local_commands_do_not_initialize_credentials(self):
        process = self.process(b'local check output\n')
        with patch.object(release.subprocess, 'Popen', return_value=process), contextlib.redirect_stdout(io.StringIO()):
            self.runner.run('local-check', ['fixture-local-tool'])
        self.factory.assert_not_called()

    def test_secret_write_failure_releases_process_without_logging_secret(self):
        marker = 'BG_RELEASE_SUDO_test_only_failure'
        process = self.process(marker.encode() + b'\n')
        self.credentials.send_sudo_password.side_effect = OSError('test-only closed input')
        with (patch.object(release.subprocess, 'Popen', return_value=process),
              contextlib.redirect_stdout(io.StringIO()), self.assertRaises(OSError)):
            self.runner.run('ready', ['ssh', '-tt', release.SSH_TARGET, 'readiness'], sudo_marker=marker)
        self.credentials.release_process.assert_called_once_with(4321)
        process.terminate.assert_called()
        self.assertTrue(process.stdin.closed)


class PipePeerAuthorizationTests(unittest.TestCase):
    def broker(self):
        broker = object.__new__(auth._WindowsBroker)
        broker._stop = threading.Event()
        broker._condition = threading.Condition()
        broker._expected_python = 'test-only-python.exe'
        parent = (1000, 'test-only-ssh.exe', 'test-only-user-sid')
        identities = {111: (2000, broker._expected_python, parent[2]), 222: parent}
        broker.api = Mock(user_sid=parent[2], process_identity=Mock(side_effect=identities.__getitem__),
                          parents=Mock(return_value={111: 222}))
        broker._active = {222: parent}
        return broker, identities

    def test_only_expected_python_descendant_of_live_authorized_process_is_accepted(self):
        broker, identities = self.broker()
        self.assertTrue(broker._authorized(111, time.monotonic() + 1))
        for identity in ((2000, 'different-python.exe', 'test-only-user-sid'),
                         (2000, broker._expected_python, 'different-user-sid')):
            with self.subTest(identity=identity):
                identities[111] = identity
                self.assertFalse(broker._authorized(111, time.monotonic() + 1))

    def test_reused_parent_pid_and_expired_process_authorization_are_rejected(self):
        broker, identities = self.broker()
        identities[222] = (1001, 'test-only-ssh.exe', 'test-only-user-sid')
        self.assertFalse(broker._authorized(111, time.monotonic() + 1))
        broker._active.clear()
        self.assertFalse(broker._authorized(111, time.monotonic() - 1))


class AuthenticatedPayloadTests(unittest.TestCase):
    @staticmethod
    def remote_source(command):
        bootstrap = ast.parse(shlex.split(command[-1])[2])
        decoder = next(node for node in ast.walk(bootstrap)
                       if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                       and node.func.attr == 'b64decode')
        return base64.b64decode(ast.literal_eval(decoder.args[0])).decode('utf-8')

    def assert_protected_payload(self, command, options):
        self.assertEqual(command[:3], ['ssh', '-tt', release.SSH_TARGET])
        source = self.remote_source(command)
        tree = ast.parse(source)
        helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                      and node.name == 'run_with_sudo')
        self.assertTrue(any(isinstance(node, (ast.Import, ast.ImportFrom)) for node in helper.body))
        call = next(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name) and node.func.id == 'run_with_sudo')
        self.assertEqual(ast.literal_eval(call.args[0]), options['sudo_marker'])
        self.assertNotIn(PASSWORD, source)
        compile(source, '<test-only protected payload>', 'exec')
        return tree

    def test_upload_contains_all_hashed_tools_and_protected_deployment_bootstrap(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = Mock(directory=Path(folder))
            manifest = {'release_id': 'test-only-release', 'tools': release.tool_hashes()}
            release.upload_and_deploy(manifest, runner)
            upload, deployment = runner.run.call_args_list
            self.assertEqual(upload.args[0], 'upload-release')
            self.assertEqual(upload.args[1][0], 'scp')
            self.assertEqual(deployment.args[0], 'server-pull-build-deploy')
            with zipfile.ZipFile(upload.args[1][1]) as bundle:
                self.assertEqual(set(bundle.namelist()), set(release.TOOL_FILES) | {'manifest.json'})
                self.assertIn('release_auth.py', manifest['tools'])
                for name in bundle.namelist():
                    self.assertNotIn(PASSWORD.encode(), bundle.read(name))
            tree = self.assert_protected_payload(deployment.args[1], deployment.kwargs)
            self.assertTrue(any(isinstance(node, ast.FunctionDef) and node.name == 'deploy_release'
                                for node in tree.body))

    def test_readiness_before_upload_embeds_its_auth_helper_and_passes_exact_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = Mock(directory=Path(folder), counter=1)
            (runner.directory / '001-server-readiness.log').write_text(
                'BG_RELEASE_SERVER_STATE {"active_count": 0}\n', encoding='utf-8')
            self.assertEqual(release.server_readiness({}, runner), {'active_count': 0})
            self.assertEqual(runner.run.call_args.args[0], 'server-readiness')
            tree = self.assert_protected_payload(runner.run.call_args.args[1], runner.run.call_args.kwargs)
            self.assertTrue(any(isinstance(node, ast.FunctionDef) and node.name == 'read_server_state'
                                for node in tree.body))

    def test_auth_module_changes_invalidate_tool_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for name in release.TOOL_FILES:
                (directory / name).write_text('test-only initial content', encoding='utf-8')
            with patch.object(release, '__file__', str(directory / 'release_pipeline.py')):
                before = release.tool_hashes()
                (directory / 'release_auth.py').write_text('test-only changed content', encoding='utf-8')
                after = release.tool_hashes()
            self.assertNotEqual(before['release_auth.py'], after['release_auth.py'])
            self.assertEqual(before['release_pipeline.py'], after['release_pipeline.py'])
            self.assertEqual(before['release_test_settings.py'], after['release_test_settings.py'])


class RemoteSudoProtocolTests(unittest.TestCase):
    def invoke(self, action, *, valid_password=True):
        marker = 'BG_RELEASE_SUDO_READY_test_only'
        output = io.StringIO()
        original = [0, 0, 0, 72, 0, 0, []]
        terminal = SimpleNamespace(ECHO=8, ECHONL=64, TCSANOW=0, error=OSError,
                                   tcgetattr=Mock(side_effect=lambda _: original.copy()), tcsetattr=Mock())
        frames = []

        def read_frame(*args):
            self.assertIn(marker, output.getvalue(), 'The client must wait for the echo-off acknowledgement')
            protected = terminal.tcsetattr.call_args.args[2]
            self.assertEqual(protected[3] & (terminal.ECHO | terminal.ECHONL), 0)
            return base64.b64encode(PASSWORD.encode()) + b'\n'

        def sudo(command, **options):
            self.assertNotIn(PASSWORD, repr(command))
            frames.append(bytes(options['input']))
            return subprocess.CompletedProcess(command, 0 if valid_password else 1)

        worker = Mock()
        with contextlib.ExitStack() as patches:
            patches.enter_context(patch.dict(sys.modules, {'termios': terminal}))
            patches.enter_context(patch.object(sys, 'stdin', Mock(fileno=Mock(return_value=99))))
            patches.enter_context(contextlib.redirect_stdout(output))
            patches.enter_context(patch('os.isatty', return_value=True))
            patches.enter_context(patch('os.read', side_effect=read_frame))
            patches.enter_context(patch('select.select', return_value=([99], [], [])))
            patches.enter_context(patch('subprocess.run', side_effect=sudo))
            patches.enter_context(patch('threading.Thread', return_value=worker))
            try:
                return auth.run_with_sudo(marker, action)
            finally:
                self.assertEqual(frames, [PASSWORD.encode() + b'\n'])
                self.assertEqual(terminal.tcsetattr.call_args.args[2], original)
                self.assertNotIn(PASSWORD, output.getvalue())
                self.assertNotIn(base64.b64encode(PASSWORD.encode()).decode(), output.getvalue())
                if valid_password:
                    worker.join.assert_called_once()

    def test_echo_off_before_private_input_and_cleanup_after_success(self):
        self.assertEqual(self.invoke(lambda: 'completed'), 'completed')

    def test_bad_password_never_starts_the_deployment_action(self):
        action = Mock()
        with self.assertRaises(RuntimeError):
            self.invoke(action, valid_password=False)
        action.assert_not_called()

    def test_action_failure_still_stops_refresh_and_restores_terminal(self):
        with self.assertRaisesRegex(RuntimeError, 'test-only deployment failure'):
            self.invoke(Mock(side_effect=RuntimeError('test-only deployment failure')))


if __name__ == '__main__':
    unittest.main()
