"""The SSH readiness payload must carry a Linux path from either host OS."""
import ast
import base64
from pathlib import Path, PurePosixPath, PureWindowsPath
import shlex
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_pipeline as release


class ServerReadinessPathTests(unittest.TestCase):
    def test_ssh_payload_preserves_absolute_posix_server_root(self):
        expected = '/home/dev/backgammon-project'
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            result = {'active_count': 0, 'already_current': False}
            (directory / '001-server-readiness.log').write_text(
                'BG_RELEASE_SERVER_STATE {"active_count": 0, "already_current": false}\n',
                encoding='utf-8',
            )
            runner = Mock(directory=directory, counter=1)
            for host_root in (PureWindowsPath(expected), PurePosixPath(expected)):
                with self.subTest(host_root=type(host_root).__name__):
                    with patch.object(release, 'SERVER_ROOT', host_root):
                        self.assertEqual(release.server_readiness({}, runner), result)
                    stage, argv = runner.run.call_args.args
                    self.assertEqual(stage, 'server-readiness')
                    bootstrap = ast.parse(shlex.split(argv[-1])[2])
                    decoder = next(node for node in ast.walk(bootstrap)
                                   if isinstance(node, ast.Call)
                                   and isinstance(node.func, ast.Attribute)
                                   and node.func.attr == 'b64decode')
                    wire_source = base64.b64decode(ast.literal_eval(decoder.args[0])).decode('ascii')
                    remote_call = next(node for node in ast.walk(ast.parse(wire_source))
                                       if isinstance(node, ast.Call)
                                       and isinstance(node.func, ast.Name)
                                       and node.func.id == 'read_server_state')
                    config = ast.literal_eval(remote_call.args[0])
                    self.assertEqual(config['root'], expected)
                    self.assertTrue(PurePosixPath(config['root']).is_absolute())
