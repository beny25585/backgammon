"""Configure the dedicated build worker while retaining its BuildKit cache volume."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tomllib

BUILDERS = {'backgammon-release-builder', 'backgammon-build'}
MEMORY = 3 * 1024 ** 3
PERIOD = 100000
QUOTA = 200000
DRIVER_OPTIONS = 'memory=3g,memory-swap=3g,cpu-period=100000,cpu-quota=200000,default-load=true,restart-policy=no'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def checked(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, result.stderr.decode(errors='replace')[-6000:])
    return result.stdout


def bootstrap(docker, builder):
    # Keep image-pull and daemon-start progress visible in the release log.
    result = subprocess.run([*docker, 'buildx', 'inspect', '--bootstrap', builder])
    require(result.returncode == 0, 'Build worker bootstrap failed')


def inspect(docker, *args):
    result = subprocess.run([*docker, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        detail = result.stderr.decode(errors='replace')
        if any(marker in detail.lower() for marker in ('no such', 'no builder', 'not found')):
            return None
        raise RuntimeError(detail[-6000:])
    value = json.loads(result.stdout)
    if isinstance(value, list):
        require(len(value) == 1, 'Unexpected Docker inspection result')
        return value[0]
    return value


def configuration(docker, container):
    data = checked([*docker, 'cp', container + ':/etc/buildkit/buildkitd.toml', '-'])
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        files = archive.getmembers()
        require(len(files) == 1 and files[0].isfile() and files[0].size <= 65536,
                'Unexpected build worker configuration archive')
        return tomllib.loads(archive.extractfile(files[0]).read().decode())


def builder_metadata(docker, name):
    # Buildx supports JSON formatting on ls, not on inspect.
    data = checked([*docker, 'buildx', 'ls', '--format', 'json'])
    matches = [value for line in data.splitlines() if line.strip()
               for value in (json.loads(line),) if value.get('Name') == name]
    require(len(matches) <= 1, 'Duplicate build worker metadata')
    return matches[0] if matches else None


def limits(container):
    settings = container['HostConfig']
    require(settings.get('NanoCpus', 0) == 0, 'Unexpected additional builder CPU limit')
    return tuple(settings[key] for key in ('Memory', 'MemorySwap', 'CpuPeriod', 'CpuQuota'))


def cache_identity(volume):
    return tuple(volume[key] for key in ('Name', 'Driver', 'Mountpoint', 'CreatedAt'))


def configure(docker, builder):
    require(builder in BUILDERS, 'Only the dedicated Backgammon builders may be configured')
    config = Path(__file__).with_name('buildkit.production.toml')
    wanted = tomllib.loads(config.read_text(encoding='utf-8'))
    require(wanted == {'worker': {'oci': {'max-parallelism': 2}}}, 'Unexpected build worker policy')
    node = builder + '0'
    container_name = 'buildx_buildkit_' + node
    volume_name = container_name + '_state'
    metadata = builder_metadata(docker, builder)
    container = inspect(docker, 'inspect', container_name)
    cached = inspect(docker, 'volume', 'inspect', volume_name)
    recreate = False
    if metadata is not None:
        require(metadata['Driver'] == 'docker-container' and len(metadata['Nodes']) == 1
                and metadata['Nodes'][0]['Name'] == node, 'Unexpected existing builder topology')
        require(not metadata.get('Err') and not metadata['Nodes'][0].get('Err'),
                'Existing builder inspection failed; leave it unchanged')
        if container is not None:
            mounts = [mount for mount in container['Mounts'] if mount['Destination'] == '/var/lib/buildkit']
            require(len(mounts) == 1 and mounts[0]['Type'] == 'volume'
                    and mounts[0]['Name'] == volume_name and cached is not None,
                    'Existing build cache ownership differs')
            current = configuration(docker, container_name)
            require(current in (wanted, {'worker': {'oci': {'max-parallelism': 1}}}),
                    'Existing builder has custom configuration; leave it unchanged')
            profile = limits(container)
            require(profile in ((MEMORY, MEMORY, PERIOD, PERIOD), (MEMORY, MEMORY, PERIOD, QUOTA)),
                    'Existing builder has unexpected resource limits; leave it unchanged')
            recreate = current != wanted or profile != (MEMORY, MEMORY, PERIOD, QUOTA)
            if recreate:
                require(not container['State']['Running'],
                        'Existing builder is running; wait for its build to finish before updating it')
        else:
            require(metadata['Nodes'][0].get('Status') != 'running',
                    'Existing builder node is running elsewhere; leave it unchanged')
            recreate = True
        if recreate:
            print('Updating stopped build worker; retaining its cache volume.', flush=True)
            checked([*docker, 'buildx', 'rm', '--keep-state', builder])
            if cached is not None:
                retained = inspect(docker, 'volume', 'inspect', volume_name)
                require(retained is not None and cache_identity(retained) == cache_identity(cached),
                        'Build cache volume changed during worker update')
    else:
        require(container is None, 'An unregistered build worker exists; leave it unchanged')
    if metadata is None or recreate:
        checked([*docker, 'buildx', 'create', '--name', builder, '--node', node,
                 '--driver', 'docker-container', '--driver-opt', DRIVER_OPTIONS,
                 '--buildkitd-config', str(config)])
    try:
        bootstrap(docker, builder)
        active = inspect(docker, 'inspect', container_name)
        require(active is not None and active['State']['Running']
                and limits(active) == (MEMORY, MEMORY, PERIOD, QUOTA),
                'Build worker resource limits differ after configuration')
        require(configuration(docker, container_name) == wanted, 'Build worker parallelism differs')
        mounts = [mount for mount in active['Mounts'] if mount['Destination'] == '/var/lib/buildkit']
        require(len(mounts) == 1 and mounts[0]['Type'] == 'volume' and mounts[0]['Name'] == volume_name,
                'Build worker cache mount differs after configuration')
        retained = inspect(docker, 'volume', 'inspect', volume_name)
        require(retained is not None, 'Build worker cache volume is missing')
        if cached is not None:
            require(cache_identity(retained) == cache_identity(cached), 'Build cache volume identity changed')
    except BaseException:
        if container is None or not container['State']['Running']:
            subprocess.run([*docker, 'buildx', 'stop', builder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raise
    cache_status = 'existing cache retained' if cached is not None else 'new cache volume created'
    print('Build worker ready: 2 CPUs, 3 GiB RAM, max-parallelism=2; ' + cache_status + '.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--builder', required=True, choices=sorted(BUILDERS))
    parser.add_argument('--sudo-docker', action='store_true')
    args = parser.parse_args()
    configure(['sudo', '-n', 'docker'] if args.sudo_docker else ['docker'], args.builder)


if __name__ == '__main__':
    main()
