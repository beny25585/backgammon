"""Pure configuration checks; no Docker, Django, network, or database access."""
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import copied_runtime as runtime


class CopiedRuntimeTests(unittest.TestCase):
    def setUp(self):
        services = runtime.server.SERVICES.copy()
        def restore_services():
            runtime.server.SERVICES.clear()
            runtime.server.SERVICES.update(services)
        self.addCleanup(restore_services)

    def test_private_settings_preserve_shared_values_without_mutation(self):
        original = {'SECRET_KEY': 'keep-secret', 'ANALYSIS_API_TOKEN': 'keep-token',
                    'EMAIL_BACKEND': 'smtp', 'WEB_PUSH_PRIVATE_KEY': 'old-private',
                    'WEB_PUSH_PUBLIC_KEY': 'old-public', 'WEB_PUSH_SUBJECT': 'old-origin'}
        snapshot = original.copy()
        result = runtime.private_settings(original, {'WEB_PUSH_PRIVATE_KEY': 'new-private',
                                          'WEB_PUSH_PUBLIC_KEY': 'new-public'}, runtime.server.ORIGIN)
        self.assertEqual(original, snapshot)
        self.assertEqual(result['SECRET_KEY'], original['SECRET_KEY'])
        self.assertEqual(result['ANALYSIS_API_TOKEN'], original['ANALYSIS_API_TOKEN'])
        self.assertEqual(result['WEB_PUSH_SUBJECT'], runtime.server.ORIGIN)
        self.assertEqual(result['EMAIL_BACKEND'], 'django.core.mail.backends.dummy.EmailBackend')
        self.assertEqual((result['TRANZILA_ENABLED'], result['TRANZILA_PURCHASES_ENABLED']), ('0', '0'))

    def test_private_settings_reject_reused_keys_and_non_string_configuration(self):
        with self.assertRaisesRegex(ValueError, 'new'):
            runtime.private_settings({'WEB_PUSH_PUBLIC_KEY': 'same'},
                {'WEB_PUSH_PUBLIC_KEY': 'same', 'WEB_PUSH_PRIVATE_KEY': 'new'}, runtime.server.ORIGIN)
        with self.assertRaisesRegex(ValueError, 'string'):
            runtime.private_settings({'TRANZILA_ENABLED': True},
                {'WEB_PUSH_PUBLIC_KEY': 'public', 'WEB_PUSH_PRIVATE_KEY': 'private'}, runtime.server.ORIGIN)

    def test_secret_source_accepts_normalized_absolute_and_short_targets(self):
        config = {'services': {'api': {'secrets': [{'source': 'config', 'target': '/run/secrets/config'}]}},
                  'secrets': {'config': {'file': '/private/config.json'}}}
        self.assertEqual(runtime.secret_source(config, 'api', '/run/secrets/config'), ('config', '/private/config.json'))
        config['services']['api']['secrets'][0]['target'] = 'config'
        self.assertEqual(runtime.secret_source(config, 'api', '/run/secrets/config'), ('config', '/private/config.json'))
        del config['services']['api']['secrets'][0]['target']
        self.assertEqual(runtime.secret_source(config, 'api', '/run/secrets/config'), ('config', '/private/config.json'))

    def test_secret_source_rejects_duplicates_and_bind_shadowing(self):
        config = {'services': {'api': {'secrets': [{'source': 'config'}, {'source': 'config'}]}},
                  'secrets': {'config': {'file': '/private/config.json'}}}
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            runtime.secret_source(config, 'api', '/run/secrets/config')
        config['services']['api']['secrets'].pop()
        config['services']['api']['volumes'] = [{'type': 'bind', 'target': '/run/secrets/config', 'source': '/other'}]
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            runtime.secret_source(config, 'api', '/run/secrets/config')

    def overlay_fixture(self):
        runtime.server.SERVICES.update({'analysis-api': 'analysis', 'push-worker': 'tournaments'})
        images = {'game': 'sha256:game', 'tournaments': 'sha256:tournaments', 'analysis': 'sha256:analysis'}
        base = {'name': runtime.server.PROJECT,
                'networks': {'application': {'internal': True}},
                'services': {name: {'environment': {'DB_NAME': 'original'}, 'networks': {'application': {}}}
                             for name in runtime.APIS + runtime.NEW_WORKERS},
                'secrets': {'config': {'file': '/shared/tournaments.json'}, 'password': {'file': '/shared/password'}}}
        overlay = runtime.runtime_overlay(images, 'config', Path('/private/tournaments.json'))
        effective = copy.deepcopy(base)
        effective['secrets']['config']['file'] = '/private/tournaments.json'
        effective['networks'].update(overlay['networks'])
        for name, item in overlay['services'].items():
            effective['services'][name].update(item)
        return base, effective, images, overlay

    def test_overlay_only_changes_one_secret_and_two_egress_members(self):
        base, effective, images, overlay = self.overlay_fixture()
        self.assertEqual(overlay['secrets'], {'config': {'file': '/private/tournaments.json'}})
        self.assertEqual({name for name, item in overlay['services'].items() if 'networks' in item},
                         {'tournaments-api', 'push-worker'})
        runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'))

    def test_effective_plan_rejects_database_and_password_changes(self):
        base, effective, images, _ = self.overlay_fixture()
        effective['services']['tournaments-api']['environment']['DB_NAME'] = 'production'
        with self.assertRaisesRegex(ValueError, 'context'):
            runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'))
        effective['services']['tournaments-api']['environment']['DB_NAME'] = 'original'
        effective['secrets']['password']['file'] = '/other/password'
        with self.assertRaisesRegex(ValueError, 'secret'):
            runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'))

    def test_effective_plan_rejects_public_ports_and_unexpected_egress(self):
        base, effective, images, _ = self.overlay_fixture()
        effective['services']['analysis-api']['ports'] = ['8000:8000']
        with self.assertRaises(ValueError):
            runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'))
        del effective['services']['analysis-api']['ports']
        effective['services']['analysis-api']['networks'] = ['application', 'integrations_egress']
        with self.assertRaisesRegex(ValueError, 'network'):
            runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'))

    def test_existing_outbound_network_is_preserved_without_network_override(self):
        base, effective, images, overlay = self.overlay_fixture()
        base['networks']['application']['internal'] = False
        effective['networks']['application']['internal'] = False
        self.assertNotIn('application', overlay['networks'])
        runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'), False)
        effective['networks']['application']['internal'] = True
        with self.assertRaisesRegex(ValueError, 'network'):
            runtime.verify_plan(effective, base, images, 'config', Path('/private/tournaments.json'), False)

    def listener_fixture(self):
        before = {name: f'172.20.0.{index + 2}:{port}' for index, (name, port) in enumerate(runtime.server.UPSTREAM_PORTS.items())}
        after = dict(before)
        # Swap two addresses to catch sequential replacement corruption.
        after['game-api'], after['tournaments-api'] = before['tournaments-api'], before['game-api']
        original = 'server {\n  listen 18443 ssl;\n' + '\n'.join(
            f'  location /{name}/ {{ proxy_pass http://{address}/; }}' for name, address in before.items()) + '\n}\n'
        return original, before, after

    def test_listener_replaces_swapped_addresses_without_cascade(self):
        original, before, after = self.listener_fixture()
        result = runtime.listener_content(original, before, after)
        for name, address in after.items():
            self.assertIn(f'location /{name}/ {{ proxy_pass http://{address}/;', result)

    def test_listener_refuses_public_port_or_unobserved_upstream(self):
        original, before, after = self.listener_fixture()
        with self.assertRaisesRegex(ValueError, 'structure'):
            runtime.listener_content(original.replace('18443', '443'), before, after)
        with self.assertRaisesRegex(ValueError, 'current candidate'):
            runtime.listener_content(original.replace(before['game-api'], '172.20.0.99:8000'), before, after)

    def preflight_fixture(self, root):
        root = Path(root)
        project, rehearsal = root / 'candidate', root / 'rehearsal'
        project.mkdir()
        rehearsal.mkdir()
        tools = root / 'sources/backgammon/deploy/workspace/docs/tournament-e2e'
        tools.mkdir(parents=True)
        (project / '.built-images.json').write_text(json.dumps({'image_tag': project.name,
            'sources': [], 'images': {'tournaments': {'id': 'sha256:tournaments'}}}))
        args = SimpleNamespace(project=project, rehearsal=rehearsal, tools_revision='a' * 40)
        target = {'validation_id': 'b' * 32, 'image_tag': project.name, 'sources': []}
        def run(arguments, **kwargs):
            return 'a' * 40 if 'rev-parse' in arguments else ''
        return args, target, tools, run

    def test_unverified_network_stops_before_files_or_containers_change(self):
        with TemporaryDirectory() as root:
            args, target, tools, run = self.preflight_fixture(root)
            with patch.object(runtime, '__file__', str(tools / 'copied_runtime.py')), \
                 patch.object(runtime.server, 'MANAGED_ROOT', Path(root)), \
                 patch.object(runtime.server, 'configure_target', return_value=target), \
                 patch.object(runtime.server, 'run', side_effect=run) as commands, \
                 patch.object(runtime.server, 'verify_copied_network', side_effect=ValueError('candidate-owned bridge')) as network_check, \
                 patch.object(runtime.server, 'docker') as docker:
                with self.assertRaisesRegex(ValueError, 'candidate-owned'):
                    runtime.prepare(args)
            self.assertFalse((args.rehearsal / 'copied-runtime').exists())
            self.assertEqual(network_check.call_count, 1)
            self.assertEqual(docker.call_count, 0)
            self.assertFalse(any('up' in call.args[0] for call in commands.call_args_list))

    def test_existing_browser_load_stops_runtime_reconfiguration(self):
        with TemporaryDirectory() as root:
            args, target, tools, run = self.preflight_fixture(root)
            (args.rehearsal / 'browser-load').mkdir()
            network = {'Name': runtime.server.PROJECT + '_application', 'Driver': 'bridge', 'Internal': True}
            with patch.object(runtime, '__file__', str(tools / 'copied_runtime.py')), \
                 patch.object(runtime.server, 'MANAGED_ROOT', Path(root)), \
                 patch.object(runtime.server, 'configure_target', return_value=target), \
                 patch.object(runtime.server, 'run', side_effect=run) as commands, \
                 patch.object(runtime.server, 'verify_copied_network', return_value=(network, {'internal': True})), \
                 patch.object(runtime.server, 'docker') as docker:
                with self.assertRaisesRegex(ValueError, 'already has state'):
                    runtime.prepare(args)
            self.assertFalse((args.rehearsal / 'copied-runtime').exists())
            self.assertEqual(docker.call_count, 0)
            self.assertFalse(any('up' in call.args[0] for call in commands.call_args_list))


if __name__ == '__main__':
    unittest.main()
