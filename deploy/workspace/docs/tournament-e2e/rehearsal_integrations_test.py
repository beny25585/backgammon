"""Isolation/rollback-plan checks; never contact Docker, providers, or a database."""
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context
from rehearsal_integrations import ARTIFACTS, application_readiness, candidate, integration_context, prepare_database, preserve_restored_backup, require_integration_context, verify_integration_config
from server_inventory import safe_environment
from server_rehearsal import APPS, WORKERS, select_services


class IntegrationIsolationTests(unittest.TestCase):
    def setUp(self):
        self.identity = {'session_id': 'a' * 32, 'project': PROJECT, 'origin': ORIGIN,
                         'database_context': fresh_database_context('a' * 32),
                         'images': {'analysis': 'sha256:analysis', 'tournaments': 'sha256:tournaments'}}
        self.session = {'identity': self.identity, 'admin': {'username': 'unchanged'}, 'tools_dir': '/old/tools'}
        self.overrides = {'services': {'tournaments-tasks': {
            'image': 'sha256:tournaments', 'environment': {'DB_NAME': self.identity['database_context']['databases']['tournaments']},
            'volumes': [{'target': '/opt/e2e/tournaments.json', 'source': '/state/tournaments.json', 'read_only': True}]},
            'game-api': {'image': 'unchanged', 'environment': {'DB_NAME': 'old'}}}}

    def enabled(self):
        updated, _ = candidate(self.session, self.overrides, Path('/state'), Path('/new/tools'), session_id='b' * 32)
        return updated['identity']

    def config(self):
        identity = self.enabled()
        context = integration_context(identity)
        return {'networks': {'integrations_egress': {'internal': False}}, 'services': {
            **{name: {'environment': {'DB_HOST': 'postgres', 'DB_NAME': context['analysis_database'],
                 'DB_USER': 'backgammon_analysis', 'RUNTIME_CONFIG_FILE': '/opt/e2e/analysis.json'},
                 'networks': {'application': {}}, 'ports': []}
               for name in ('analysis-api', 'analysis-worker', 'analysis-migrate')},
            'push-worker': {'networks': {'application': {}, 'integrations_egress': {}}},
            'tournaments-api': {'networks': {'application': {}, 'integrations_egress': {}}},
            'game-api': {'networks': {'application': {}}}}}

    def test_clean_plan_preserves_original_release_and_objects(self):
        original = copy.deepcopy((self.session, self.overrides))
        updated, config = candidate(self.session, self.overrides, Path('/state'), Path('/new/tools'), session_id='b' * 32)
        self.assertEqual((self.session, self.overrides), original)
        self.assertNotEqual(updated['identity']['database_context'], self.identity['database_context'])
        self.assertEqual(updated['identity']['database_context']['redis_databases'], {'game': 10, 'tournaments': 11})
        self.assertEqual(updated['identity']['images'], self.identity['images'])
        self.assertEqual(updated['admin']['username'], 'E2EAdmin_' + 'b' * 12)
        self.assertEqual(config['services']['game-api']['image'], self.overrides['services']['game-api']['image'])
        self.assertEqual(config['services']['push-worker']['environment']['DB_NAME'], 'backgammon_tournaments_e2e_' + 'b' * 12)
        self.assertEqual(config['services']['analysis-worker']['environment']['DB_NAME'], 'backgammon_analysis_e2e_' + 'b' * 12)

    def test_production_database_and_external_analysis_url_are_refused(self):
        identity = self.enabled()
        identity['integration_context']['analysis_database'] = 'backgammon_analysis'
        with self.assertRaises(ValueError):
            require_integration_context(identity)
        identity = self.enabled()
        identity['integration_context']['analysis_url'] = 'https://outside.invalid'
        with self.assertRaises(ValueError):
            require_integration_context(identity)

    def test_published_analysis_ports_or_extra_egress_are_refused(self):
        config = self.config()
        verify_integration_config(self.enabled(), config)
        config['services']['analysis-api']['ports'] = [{'published': '18007'}]
        with self.assertRaises(ValueError):
            verify_integration_config(self.enabled(), config)
        config = self.config()
        config['services']['game-api']['networks']['integrations_egress'] = {}
        with self.assertRaises(ValueError):
            verify_integration_config(self.enabled(), config)

    def test_readiness_uses_the_live_api_network_and_normal_private_runtime_loader(self):
        docker = Mock()
        rehearsal = SimpleNamespace(PROJECT=PROJECT, docker=docker)
        for kind in ('game', 'tournaments'):
            application_readiness(rehearsal, kind)
            arguments = docker.call_args.args
            self.assertEqual(arguments[:2], ('exec', PROJECT + '-' + kind + '-api-1'))
            self.assertEqual(arguments[2:6], ('python', '/opt/docker/runtime_env.py',
                                            'python', '/opt/e2e/rehearsal_app.py'))
            self.assertEqual(arguments[6:], (kind, 'integrations'))
        self.assertEqual(docker.call_count, 2)

    def test_readiness_rejects_an_unknown_service_before_executing_docker(self):
        docker = Mock()
        with self.assertRaises(ValueError):
            application_readiness(SimpleNamespace(PROJECT=PROJECT, docker=docker), 'analysis-migrate')
        docker.assert_not_called()

    def test_service_inventory_returns_to_original_when_disabled(self):
        try:
            select_services(self.enabled())
            self.assertIn('analysis-api', APPS)
            self.assertIn('push-worker', WORKERS)
            select_services(self.identity)
            self.assertNotIn('analysis-api', APPS)
            self.assertNotIn('push-worker', WORKERS)
        finally:
            select_services(self.identity)

    def test_unmarked_nonempty_database_is_never_adopted(self):
        query = Mock(side_effect=[json.dumps({'login': True, 'superuser': False, 'createdb': False, 'createrole': False}),
            json.dumps({'owner': 'backgammon_analysis', 'marker': None}), '1'])
        with self.assertRaises(ValueError):
            prepare_database(SimpleNamespace(postgres_query=query), self.identity)
        self.assertTrue(all(call.args[1].startswith('SELECT ') for call in query.call_args_list))

    def test_wrong_session_marker_is_rejected_without_a_database_write(self):
        query = Mock(side_effect=[json.dumps({'login': True, 'superuser': False, 'createdb': False, 'createrole': False}),
            json.dumps({'owner': 'backgammon_analysis', 'marker': 'different-session'})])
        with self.assertRaises(ValueError):
            prepare_database(SimpleNamespace(postgres_query=query), self.identity)
        self.assertTrue(all(call.args[1].startswith('SELECT ') for call in query.call_args_list))

    def test_inventory_never_returns_credentials_or_authenticated_urls(self):
        result = safe_environment({'WEB_PUSH_PRIVATE_KEY': 'secret-push', 'TRANZILA_APP_SECRET': 'secret-payments',
            'EMAIL_HOST_PASSWORD': 'secret-email', 'SECRET_KEY': 'secret-django', 'GOOGLE_CLIENT_ID': 'public-id',
            'REDIS_URL': 'redis://user:password@redis:6379/8', 'ANALYSIS_SERVICE_URL': 'https://user:password@example.invalid'})
        encoded = json.dumps(result)
        for secret in ('secret-push', 'secret-payments', 'secret-email', 'secret-django', 'password@', 'public-id'):
            self.assertNotIn(secret, encoded)
        self.assertTrue(result['configured']['GOOGLE_CLIENT_ID'])

    def backup(self, root):
        before = root / 'before-integrations'
        before.mkdir()
        for name in ARTIFACTS:
            value = self.session if name == 'session.json' else {}
            (before / name).write_text(json.dumps(value) if name.endswith('.json') else 'original')
        (before / 'plan.json').write_text(json.dumps({'previous_session': 'a' * 32, 'new_session': 'b' * 32}))
        return before

    def test_retry_preserves_every_original_backup_after_verified_restoration(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            before = self.backup(root)
            original = {file.name: file.read_bytes() for file in before.iterdir()}
            restored = copy.deepcopy(self.session)
            restored['identity'].update(harness_sha256='updated-tools', runtime_checks_version=1)
            preserve_restored_backup(before, restored)
            self.assertFalse(before.exists())
            archived = root / ('before-integrations-restored-' + 'b' * 12)
            self.assertEqual({file.name: file.read_bytes() for file in archived.iterdir()}, original)

    def test_retry_refuses_a_session_that_was_not_restored(self):
        with TemporaryDirectory() as directory:
            before = self.backup(Path(directory))
            current = copy.deepcopy(self.session)
            current['identity']['session_id'] = 'b' * 32
            with self.assertRaises(ValueError):
                preserve_restored_backup(before, current)
            self.assertTrue(before.is_dir())

    def test_retry_refuses_changed_images_or_incomplete_backup(self):
        with TemporaryDirectory() as directory:
            before = self.backup(Path(directory))
            changed = copy.deepcopy(self.session)
            changed['identity']['images']['analysis'] = 'sha256:another-image'
            with self.assertRaises(ValueError):
                preserve_restored_backup(before, changed)
            (before / 'game.json').unlink()
            with self.assertRaises(ValueError):
                preserve_restored_backup(before, self.session)
            self.assertTrue(before.is_dir())


if __name__ == '__main__':
    unittest.main()
