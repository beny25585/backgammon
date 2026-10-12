"""Dedicated builder upgrade checks; Docker is mocked and no volumes are changed."""
import copy
import json
import unittest
from unittest.mock import patch

import configure_builder as worker


class FakeDocker:
    name = 'backgammon-release-builder'
    volume_name = 'buildx_buildkit_' + name + '0_state'

    def __init__(self, *, old=True, running=False):
        self.metadata = {'Driver': 'docker-container', 'Nodes': [{'Name': self.name + '0', 'Status': 'stopped'}]}
        self.volume = {'Name': self.volume_name, 'Driver': 'local', 'Mountpoint': '/cache', 'CreatedAt': 'original'}
        self.settings = {'worker': {'oci': {'max-parallelism': 1 if old else 2}}}
        self.container = {
            'HostConfig': {'Memory': worker.MEMORY, 'MemorySwap': worker.MEMORY,
                           'CpuPeriod': worker.PERIOD, 'CpuQuota': worker.PERIOD if old else worker.QUOTA},
            'State': {'Running': running},
            'Mounts': [{'Destination': '/var/lib/buildkit', 'Type': 'volume', 'Name': self.volume_name}],
        }
        self.commands = []
        self.drop_cache = False
        self.template = copy.deepcopy(self.container)
        self.cache_template = copy.deepcopy(self.volume)

    def inspect(self, docker, *args):
        if args[:2] == ('buildx', 'inspect'):
            return self.metadata
        if args[:2] == ('volume', 'inspect'):
            return self.volume
        return self.container

    def checked(self, args):
        self.commands.append(args)
        if args[1:3] == ['buildx', 'rm']:
            self.metadata = None
            if self.drop_cache:
                self.volume = None
        elif args[1:3] == ['buildx', 'create']:
            self.metadata = {'Driver': 'docker-container', 'Nodes': [{'Name': self.name + '0'}]}
            if self.container is None:
                self.container = copy.deepcopy(self.template)
            if self.volume is None:
                self.volume = copy.deepcopy(self.cache_template)
            self.container['HostConfig']['CpuQuota'] = worker.QUOTA
            self.settings = {'worker': {'oci': {'max-parallelism': 2}}}
        elif args[1:3] == ['buildx', 'inspect']:
            self.container['State']['Running'] = True
        return b''


class ConfigureBuilderTests(unittest.TestCase):
    def configure(self, docker):
        with patch.object(worker, 'inspect', side_effect=docker.inspect), \
             patch.object(worker, 'builder_metadata', side_effect=lambda *_: docker.metadata), \
             patch.object(worker, 'bootstrap', side_effect=lambda command, name: docker.checked(
                 [*command, 'buildx', 'inspect', '--bootstrap', name])), \
             patch.object(worker, 'configuration', side_effect=lambda *_: docker.settings), \
             patch.object(worker, 'checked', side_effect=docker.checked):
            worker.configure(['docker'], docker.name)

    def test_stopped_legacy_worker_is_recreated_without_losing_cache(self):
        docker = FakeDocker()
        original = copy.deepcopy(docker.volume)
        self.configure(docker)
        self.assertEqual(docker.volume, original)
        self.assertEqual(docker.commands[0], ['docker', 'buildx', 'rm', '--keep-state', docker.name])
        create = docker.commands[1]
        self.assertEqual(create[create.index('--node') + 1], docker.name + '0')
        self.assertEqual(create[create.index('--driver-opt') + 1], worker.DRIVER_OPTIONS)
        self.assertEqual(docker.container['HostConfig']['Memory'], 3 * 1024 ** 3)

    def test_running_legacy_worker_is_left_unchanged(self):
        docker = FakeDocker(running=True)
        with self.assertRaisesRegex(RuntimeError, 'wait for its build'):
            self.configure(docker)
        self.assertEqual(docker.commands, [])

    def test_matching_worker_is_reused_without_removal(self):
        docker = FakeDocker(old=False, running=True)
        self.configure(docker)
        self.assertFalse(any(command[1:3] in (['buildx', 'rm'], ['buildx', 'create']) for command in docker.commands))

    def test_first_worker_creation_does_not_remove_any_builder(self):
        docker = FakeDocker()
        docker.metadata = docker.container = docker.volume = None
        self.configure(docker)
        self.assertEqual(docker.commands[0][1:3], ['buildx', 'create'])
        self.assertFalse(any(command[1:3] == ['buildx', 'rm'] for command in docker.commands))
        self.assertEqual(docker.volume['Name'], docker.volume_name)

    def test_foreign_cache_mount_and_custom_limits_are_rejected(self):
        for failure in ('mount', 'limits', 'config', 'topology'):
            with self.subTest(failure=failure):
                docker = FakeDocker()
                if failure == 'mount':
                    docker.container['Mounts'][0]['Name'] = 'production-data'
                elif failure == 'limits':
                    docker.container['HostConfig']['Memory'] = 0
                elif failure == 'config':
                    docker.settings['registry'] = {'custom': {}}
                else:
                    docker.metadata['Driver'] = 'remote'
                with self.assertRaises(RuntimeError):
                    self.configure(docker)
                self.assertEqual(docker.commands, [])

    def test_lost_cache_blocks_worker_recreation(self):
        docker = FakeDocker()
        docker.drop_cache = True
        with self.assertRaisesRegex(RuntimeError, 'cache volume changed'):
            self.configure(docker)
        self.assertEqual(len(docker.commands), 1)

    def test_unknown_builder_is_rejected_before_docker_access(self):
        with patch.object(worker, 'inspect') as inspect:
            with self.assertRaisesRegex(RuntimeError, 'dedicated'):
                worker.configure(['docker'], 'unrelated-service')
            inspect.assert_not_called()

    def test_metadata_uses_supported_json_list_command(self):
        expected = {'Name': FakeDocker.name, 'Driver': 'docker-container'}
        data = json.dumps({'Name': 'unrelated'}) + '\n' + json.dumps(expected) + '\n'
        with patch.object(worker, 'checked', return_value=data.encode()) as command:
            self.assertEqual(worker.builder_metadata(['docker'], FakeDocker.name), expected)
        command.assert_called_once_with(['docker', 'buildx', 'ls', '--format', 'json'])


if __name__ == '__main__':
    unittest.main()
