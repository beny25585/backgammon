"""Candidate network/storage provenance checks, with fake Docker inventories only."""
import copy
import json
import unittest
from unittest.mock import patch

from rehearsal_context import (ORIGIN, PROJECT, require_copied_network_context,
                               require_copied_network_config)
import server_rehearsal as server


class CopiedNetworkTests(unittest.TestCase):
    def fixture(self, internal=False):
        identity = {'validation_id': 'b' * 32, 'infrastructure_revision': 'c' * 40,
                    'origin': ORIGIN, 'project': 'backgammon-candidate-' + 'b' * 32}
        project, identifier = identity['project'], 'a' * 64
        network = {'Name': project + '_application', 'Id': identifier, 'Driver': 'bridge', 'Internal': internal,
                   'Labels': {'com.docker.compose.project': project, 'com.docker.compose.network': 'application'},
                   'Containers': {}}
        containers, volumes = [], {}
        for index, service in enumerate(('postgres', 'redis', 'game-api'), 1):
            name, container_id = project + '-' + service + '-1', str(index) * 64
            row = {'Id': container_id, 'Name': '/' + name,
                   'Config': {'Labels': {'com.docker.compose.project': project, 'com.docker.compose.service': service}},
                   'NetworkSettings': {'Networks': {network['Name']: {'NetworkID': identifier}}, 'Ports': {}},
                   'HostConfig': {'PortBindings': {}}, 'Mounts': []}
            if service != 'game-api':
                volume_name = project + '_' + service + '_data'
                row['Mounts'] = [{'Type': 'volume', 'Name': volume_name, 'RW': True,
                    'Destination': '/var/lib/postgresql/data' if service == 'postgres' else '/data'}]
                volumes[volume_name] = {'Name': volume_name, 'Driver': 'local',
                    'Labels': {'com.docker.compose.project': project, 'com.docker.compose.volume': service + '_data'}}
            else:
                row['NetworkSettings']['Ports'] = {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18005'}]}
            containers.append(row)
            network['Containers'][container_id] = {'Name': name}
        return identity, network, containers, volumes

    def config(self, identity, context):
        project = identity['project']
        return {'name': project, 'networks': {'application': {'name': context['name'], 'internal': context['internal']}},
                'volumes': {kind + '_data': {'name': project + '_' + kind + '_data'} for kind in ('postgres', 'redis')},
                'services': {
                    'postgres': {'volumes': [{'type': 'volume', 'source': 'postgres_data', 'target': '/var/lib/postgresql/data'}]},
                    'redis': {'volumes': [{'type': 'volume', 'source': 'redis_data', 'target': '/data'}]},
                    'game-api': {'ports': [{'host_ip': '127.0.0.1', 'published': '18005', 'target': 8000}]}}}

    def test_verified_candidate_bridge_preserves_both_network_modes(self):
        for internal in (False, True):
            with self.subTest(internal=internal):
                identity, network, containers, volumes = self.fixture(internal)
                context = require_copied_network_context(identity, network, containers, volumes)
                self.assertIs(context['internal'], internal)
                self.assertEqual(context['id'], network['Id'])
                self.assertEqual(context['data_volumes']['postgres'], identity['project'] + '_postgres_data')

    def test_another_project_on_network_or_using_data_volume_is_rejected(self):
        for member in (False, True):
            with self.subTest(network_member=member):
                identity, network, containers, volumes = self.fixture()
                foreign = copy.deepcopy(containers[0])
                foreign['Id'] = 'f' * 64
                foreign['Config']['Labels']['com.docker.compose.project'] = 'production'
                containers.append(foreign)
                if member:
                    network['Containers'][foreign['Id']] = {'Name': 'production-postgres'}
                with self.assertRaisesRegex(ValueError, 'Another project'):
                    require_copied_network_context(identity, network, containers, volumes)

    def test_bridge_ownership_and_complete_inventory_are_required(self):
        identity, network, containers, volumes = self.fixture()
        for key, value in (('Name', 'production_application'), ('Driver', 'host'), ('Internal', 'false'), ('Id', 'invalid')):
            with self.subTest(key=key), self.assertRaises(ValueError):
                require_copied_network_context(identity, dict(network, **{key: value}), containers, volumes)
        network['Labels']['com.docker.compose.project'] = 'production'
        with self.assertRaisesRegex(ValueError, 'candidate-owned'):
            require_copied_network_context(identity, network, containers, volumes)
        identity, network, containers, volumes = self.fixture()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            require_copied_network_context(identity, network, containers[:-1], volumes)

    def test_public_application_port_and_any_database_port_are_rejected(self):
        for service_index, address in ((2, '0.0.0.0'), (2, ''), (0, '127.0.0.1'), (1, '::1')):
            with self.subTest(service_index=service_index, address=address):
                identity, network, containers, volumes = self.fixture()
                containers[service_index]['HostConfig']['PortBindings'] = {'8000/tcp': [{'HostIp': address, 'HostPort': '9999'}]}
                with self.assertRaisesRegex(ValueError, 'ports'):
                    require_copied_network_context(identity, network, containers, volumes)

    def test_bind_shared_or_unowned_data_storage_is_rejected(self):
        for mutation in ('bind', 'name', 'readonly', 'volume_owner'):
            with self.subTest(mutation=mutation):
                identity, network, containers, volumes = self.fixture()
                mount = containers[0]['Mounts'][0]
                if mutation == 'bind':
                    mount['Type'] = 'bind'
                elif mutation == 'name':
                    mount['Name'] = 'production_postgres_data'
                elif mutation == 'readonly':
                    mount['RW'] = False
                else:
                    volumes[mount['Name']]['Labels']['com.docker.compose.project'] = 'production'
                with self.assertRaisesRegex(ValueError, 'volume'):
                    require_copied_network_context(identity, network, containers, volumes)

    def test_recorded_network_id_or_mode_cannot_drift(self):
        for mutation in ('id', 'internal'):
            with self.subTest(mutation=mutation):
                identity, network, containers, volumes = self.fixture()
                identity['network_context'] = require_copied_network_context(identity, network, containers, volumes)
                if mutation == 'id':
                    network['Id'] = 'e' * 64
                    for row in containers:
                        row['NetworkSettings']['Networks'][network['Name']]['NetworkID'] = network['Id']
                else:
                    network['Internal'] = True
                with self.assertRaisesRegex(ValueError, 'identity changed'):
                    require_copied_network_context(identity, network, containers, volumes)

    def test_compose_retains_network_mode_and_exact_candidate_volumes(self):
        for internal in (False, True):
            with self.subTest(internal=internal):
                identity, network, containers, volumes = self.fixture(internal)
                context = require_copied_network_context(identity, network, containers, volumes)
                identity['network_context'] = context
                config = self.config(identity, context)
                self.assertEqual(require_copied_network_config(identity, config), context)
                if not internal:
                    del config['networks']['application']['internal']
                    require_copied_network_config(identity, config)

    def test_compose_rejects_network_change_public_ports_or_volume_replacement(self):
        for mutation in ('internal', 'external', 'public_port', 'database_port', 'volume_name', 'bind'):
            with self.subTest(mutation=mutation):
                identity, network, containers, volumes = self.fixture()
                context = require_copied_network_context(identity, network, containers, volumes)
                identity['network_context'] = context
                config = self.config(identity, context)
                if mutation == 'internal':
                    config['networks']['application']['internal'] = True
                elif mutation == 'external':
                    config['networks']['application']['external'] = True
                elif mutation == 'public_port':
                    config['services']['game-api']['ports'][0]['host_ip'] = '0.0.0.0'
                elif mutation == 'database_port':
                    config['services']['postgres']['ports'] = [{'host_ip': '127.0.0.1', 'published': '5432', 'target': 5432}]
                elif mutation == 'volume_name':
                    config['volumes']['postgres_data']['name'] = 'production_postgres_data'
                else:
                    config['services']['postgres']['volumes'][0]['type'] = 'bind'
                with self.assertRaises(ValueError):
                    require_copied_network_config(identity, config)

    def test_historical_rehearsal_cannot_use_candidate_exception(self):
        identity, network, containers, volumes = self.fixture()
        identity = {'project': PROJECT, 'origin': ORIGIN}
        with self.assertRaisesRegex(ValueError, 'candidate-owned'):
            require_copied_network_context(identity, network, containers, volumes)

    def test_historical_upstreams_still_require_an_internal_bridge(self):
        network = {'Name': PROJECT + '_application', 'Driver': 'bridge', 'Internal': False}
        with patch.object(server, 'PROJECT', PROJECT), \
             patch.object(server, 'docker', return_value=json.dumps([network])):
            with self.assertRaisesRegex(ValueError, 'internal rehearsal bridge'):
                server.discover_upstreams({'identity': {'project': PROJECT, 'origin': ORIGIN}})

    def test_host_inventory_checks_users_of_both_data_volumes(self):
        for foreign_consumer in (False, True):
            with self.subTest(foreign_consumer=foreign_consumer):
                identity, network, containers, volumes = self.fixture()
                if foreign_consumer:
                    foreign = copy.deepcopy(containers[0])
                    foreign['Id'] = 'f' * 64
                    foreign['Config']['Labels']['com.docker.compose.project'] = 'production'
                    containers.append(foreign)
                def docker(*arguments, **kwargs):
                    if arguments[:2] == ('network', 'inspect'):
                        return json.dumps([network])
                    if arguments[:2] == ('volume', 'inspect'):
                        return json.dumps(list(volumes.values()))
                    if arguments[0] == 'ps':
                        if 'postgres_data' in arguments[-1]:
                            return containers[0]['Id'] + ('\n' + 'f' * 64 if foreign_consumer else '')
                        return containers[1]['Id']
                    if arguments[0] == 'inspect':
                        self.assertNotIn('.Config.Env', arguments[-1])
                        return '\n'.join(json.dumps(row) for row in containers)
                    self.fail('Unexpected Docker command')
                with patch.object(server, 'docker', side_effect=docker) as calls:
                    if foreign_consumer:
                        with self.assertRaisesRegex(ValueError, 'Another project'):
                            server.verify_copied_network(identity)
                    else:
                        observed, context = server.verify_copied_network(identity)
                        self.assertEqual(observed['Id'], network['Id'])
                        self.assertIs(context['internal'], False)
                self.assertEqual(sum(call.args[0] == 'ps' for call in calls.call_args_list), 2)


if __name__ == '__main__':
    unittest.main()
