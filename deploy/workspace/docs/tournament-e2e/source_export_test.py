"""User-run checks for exporting committed sources without new repository clones."""
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from prepare_workspace import existing_sources, export_source, github_repository


def archive(name, content=b'committed code'):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as bundle:
        entry = tarfile.TarInfo(name)
        entry.size = len(content)
        bundle.addfile(entry, io.BytesIO(content))
    return stream.getvalue()


class ExistingSourceTests(unittest.TestCase):
    def test_ssh_and_https_identify_the_same_repository(self):
        expected = github_repository('https://github.com/beny25585/backgammon-tournament-ui.git')
        for url in ('git@github.com:beny25585/backgammon-tournament-ui.git',
                    'ssh://git@github.com/beny25585/backgammon-tournament-ui.git'):
            with self.subTest(url=url):
                self.assertEqual(github_repository(url), expected)
        self.assertNotEqual(github_repository('git@github.com:other/backgammon-tournament-ui.git'), expected)
        with self.assertRaises(ValueError):
            github_repository('https://github.com.example/beny25585/backgammon-tournament-ui.git')

    def test_dirty_repository_stops_before_any_pull(self):
        sources = [
            {'path': 'Backgammon Game', 'url': 'https://github.com/example/game.git'},
            {'path': 'backgammon-tournaments', 'url': 'https://github.com/example/ui.git'},
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('backgammon', 'backgammon-tournament-ui'):
                (root / name / '.git').mkdir(parents=True)

            def output(checkout, *args, **kwargs):
                if args == ('rev-parse', '--show-toplevel'):
                    return str(checkout).encode()
                if args == ('remote', 'get-url', 'origin'):
                    return sources[0 if checkout.name == 'backgammon' else 1]['url'].encode()
                if args[0] == 'status':
                    return b' M source.py' if checkout.name == 'backgammon-tournament-ui' else b''
                return b'master'

            with patch('prepare_workspace.git', side_effect=output) as run:
                with self.assertRaisesRegex(ValueError, 'tracked server edits'):
                    existing_sources(root, sources, pull=True)
            self.assertFalse(any(call.args[1] == 'pull' for call in run.call_args_list))

    def test_export_rejects_modified_partial_source(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            with patch('prepare_workspace.git', return_value=archive('source.py')):
                export_source(target, 'a' * 40, target)
                (target / 'source.py').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'Partial source export differs'):
                    export_source(target, 'a' * 40, target)
            self.assertEqual((target / 'source.py').read_bytes(), b'changed')

    def test_archive_cannot_escape_source_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source'
            with patch('prepare_workspace.git', return_value=archive('../outside.py')):
                with self.assertRaisesRegex(ValueError, 'Unsupported source archive entry'):
                    export_source(Path(directory), 'a' * 40, target)
            self.assertFalse((Path(directory) / 'outside.py').exists())
