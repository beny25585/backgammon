"""Filesystem-only candidate policy tests; no Docker, SSH or database access."""
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import server_rehearsal as server


class CopiedCandidateTargetTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.project = self.root / 'deploy/backgammon-deploy/backgammon-production-candidate-20261007-r7'
        self.project.mkdir(parents=True)
        self.validation = 'b' * 32
        self.rehearsal = self.root / 'backups/backgammon-backups' / (
            'validation-' + self.validation) / 'docker-rehearsal'
        self.rehearsal.mkdir(parents=True)
        self.args = SimpleNamespace(project=self.project, rehearsal=self.rehearsal, copied_load=True)
        self.plan = {'validation_id': self.validation, 'infrastructure_revision': 'c' * 40,
                     'release': {'image_tag': self.project.name,
                                 'sources': [{'path': 'Backgammon Game', 'revision': 'd' * 40}]}}
        self.plan_file = self.root / 'reports/release-validation' / self.project.name / 'plan.json'
        self.plan_file.parent.mkdir(parents=True)
        self.save(self.plan_file, self.plan)
        self.artifact = {**self.plan['release'], 'infrastructure_revision': self.plan['infrastructure_revision']}
        for name in ('.workspace-release.json', '.built-images.json'):
            self.save(self.project / name, self.artifact)
        for name, value in (('MANAGED_ROOT', self.root), ('PROJECT', server.PROJECT), ('TAG', server.TAG)):
            guard = patch.object(server, name, value)
            guard.start()
            self.addCleanup(guard.stop)

    @staticmethod
    def save(file, value):
        file.write_text(json.dumps(value), encoding='utf-8')

    def test_copied_candidate_uses_the_plan_when_old_target_marker_is_absent(self):
        target = server.configure_target(self.args)
        self.assertEqual(target['validation_id'], self.validation)
        self.assertEqual(target['project_dir'], str(self.project))
        self.assertEqual(server.PROJECT, 'backgammon-candidate-' + self.validation)
        self.assertFalse((self.rehearsal / 'validation-target.json').exists())

    def test_standard_rehearsal_still_requires_its_candidate_marker(self):
        self.args.copied_load = False
        with self.assertRaisesRegex(ValueError, 'Unexpected release or rehearsal directory'):
            server.configure_target(self.args)

    def test_other_rehearsal_or_project_is_rejected(self):
        for changes in ({'rehearsal': self.rehearsal.parent / 'other'},
                        {'project': self.root / 'production' / self.project.name}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                server.configure_target(SimpleNamespace(**{**vars(self.args), **changes}))

    def test_plan_and_deployment_artifacts_must_have_matching_revisions(self):
        for name in ('.workspace-release.json', '.built-images.json'):
            for key, value in (('infrastructure_revision', 'e' * 40),
                               ('image_tag', 'backgammon-other'), ('sources', [])):
                with self.subTest(name=name, key=key), self.assertRaises(ValueError):
                    self.save(self.project / name, {**self.artifact, key: value})
                    server.configure_target(self.args)
                self.save(self.project / name, self.artifact)

    def test_missing_plan_or_built_inventory_is_rejected(self):
        for file in (self.plan_file, self.project / '.built-images.json'):
            value = file.read_text()
            file.unlink()
            with self.subTest(file=file.name), self.assertRaises(ValueError):
                server.configure_target(self.args)
            file.write_text(value)


if __name__ == '__main__':
    unittest.main()
