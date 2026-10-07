"""Retirement base configuration guards; no Docker, Git, network or database."""
import copy
from pathlib import Path
import unittest

from refresh_r7_load import require_base_api_config


class R7BaseConfigurationTests(unittest.TestCase):
    def fixture(self):
        identity = {'project': 'candidate', 'images': {'game': 'sha256:game', 'tournaments': 'sha256:tournaments'},
            'database_context': {'databases': {'game': 'copied_game', 'tournaments': 'copied_tournaments'},
                                 'redis_databases': {'game': 0, 'tournaments': 1}},
            'runtime_files': {'game': '/run/secrets/game_config', 'tournaments': '/run/secrets/tournaments_config'}}
        config = {'name': 'candidate', 'services': {},
                  'secrets': {'tournaments_config': {'file': str(Path('/private/tournaments.json'))}}}
        for kind, module in (('game', 'backgammon_project.settings_docker'), ('tournaments', 'tournaments.settings.docker')):
            callback = 'GAMELINK_TOURNAMENTS_URL' if kind == 'game' else 'GAMELINK_BACKGAMMON_URL'
            config['services'][kind + '-api'] = {'image': identity['images'][kind], 'secrets': [],
                'environment': {'DJANGO_SETTINGS_MODULE': module, 'DB_HOST': 'postgres',
                    'DB_USER': 'backgammon_' + kind, 'DB_NAME': identity['database_context']['databases'][kind],
                    'REDIS_URL': f'redis://redis:6379/{0 if kind == "game" else 1}',
                    'RUNTIME_CONFIG_FILE': identity['runtime_files'][kind], callback: 'https://test.invalid:18443'}}
        config['services']['tournaments-api']['secrets'] = [{'source': 'tournaments_config'}]
        # Original Compose keeps tags for other services; retiring APIs does not mutate them.
        config['services']['game-frontend'] = {'image': 'frontend:prepared-tag'}
        return config, {'identity': identity}

    def check(self, config, session):
        require_base_api_config(config, session, 'https://test.invalid:18443', Path('/private/tournaments.json'))

    def test_original_tagged_frontend_is_allowed_but_recreated_apis_keep_image_ids(self):
        config, session = self.fixture()
        before = copy.deepcopy(config)
        self.check(config, session)
        self.assertEqual(config, before)
        config['services']['game-api']['image'] = 'game:mutable-tag'
        with self.assertRaisesRegex(ValueError, 'pinned image'):
            self.check(config, session)

    def test_database_callback_observer_and_ports_mismatch_are_rejected(self):
        for env in ({'DB_NAME': 'production'}, {'DB_HOST': 'outside'}, {'REDIS_URL': 'redis://redis:6379/9'},
                    {'GAMELINK_TOURNAMENTS_URL': 'https://production.invalid'},
                    {'DJANGO_SETTINGS_MODULE': 'rehearsal_settings'}, {'E2E_ADMISSION_KIND': 'game'}):
            config, session = self.fixture()
            config['services']['game-api']['environment'].update(env)
            with self.assertRaises(ValueError):
                self.check(config, session)
        for item in ({'ports': [{'published': 8005}]},
                     {'volumes': [{'target': '/opt/e2e/session.json', 'source': '/old/session.json'}]}):
            config, session = self.fixture()
            config['services']['game-api'].update(item)
            with self.assertRaises(ValueError):
                self.check(config, session)

    def test_shared_tournaments_secret_and_other_project_are_rejected(self):
        config, session = self.fixture()
        config['secrets']['tournaments_config']['file'] = '/etc/backgammon-docker/tournaments.json'
        with self.assertRaisesRegex(ValueError, 'private'):
            self.check(config, session)
        config, session = self.fixture()
        config['name'] = 'another-project'
        with self.assertRaisesRegex(ValueError, 'project'):
            self.check(config, session)


if __name__ == '__main__':
    unittest.main()
