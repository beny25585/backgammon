"""Pure update-plan checks; no Docker, SSH, services, or database access."""
import copy
from pathlib import Path
import unittest

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context
from update_rehearsal_entry import NEW_REVISION, OLD_IMAGE, OLD_REVISION, SERVICES, candidate, validate_old


class EntryUpdatePlanTests(unittest.TestCase):
    def setUp(self):
        self.session = {'identity': {
            'session_id': 'a' * 32, 'project': PROJECT, 'origin': ORIGIN,
            'database_context': fresh_database_context('a' * 32), 'image_tag': 'R2',
            'images': {'tournaments': OLD_IMAGE, 'game': 'unchanged'},
            'sources': [{'path': 'backgammon-tournaments-backend', 'revision': OLD_REVISION}],
        }, 'tools_dir': '/old/tools', 'admin': {'username': 'unchanged'}}
        self.overrides = {'services': {
            service: {'image': OLD_IMAGE, 'environment': {'DB_NAME': 'unchanged'}} for service in SERVICES}}
        self.overrides['services']['game-api'] = {'image': 'unchanged'}

    def test_plan_preserves_database_admin_other_images_and_original_objects(self):
        previous = copy.deepcopy((self.session, self.overrides))
        updated, config = candidate(self.session, self.overrides, {'id': 'new-image'}, Path('/new/tools'))
        self.assertEqual((self.session, self.overrides), previous)
        self.assertEqual(updated['identity']['database_context'], self.session['identity']['database_context'])
        self.assertEqual(updated['admin'], self.session['admin'])
        self.assertEqual(updated['identity']['images']['game'], 'unchanged')
        self.assertEqual(updated['identity']['sources'][0]['revision'], NEW_REVISION)
        for service in SERVICES:
            self.assertEqual(config['services'][service]['image'], 'new-image')
            self.assertEqual(config['services'][service]['environment'], {'DB_NAME': 'unchanged'})
        self.assertEqual(config['services']['game-api'], {'image': 'unchanged'})

    def test_unmeasured_base_image_and_production_database_are_rejected(self):
        self.session['identity']['images']['tournaments'] = 'unknown'
        with self.assertRaises(ValueError):
            validate_old(self.session)
        self.session['identity']['images']['tournaments'] = OLD_IMAGE
        self.session['identity']['database_context']['databases']['tournaments'] = 'backgammon_tournaments'
        with self.assertRaises(ValueError):
            validate_old(self.session)

    def test_unexpected_worker_image_is_rejected_before_switching(self):
        self.overrides['services']['tournaments-tasks']['image'] = 'unknown'
        with self.assertRaises(ValueError):
            candidate(self.session, self.overrides, {'id': 'new-image'}, Path('/new/tools'))


if __name__ == '__main__':
    unittest.main()
