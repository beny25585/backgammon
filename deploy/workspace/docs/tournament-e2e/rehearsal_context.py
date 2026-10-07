"""Database identity shared by host provisioning and the container-side audit."""
import re

PROJECT = 'backgammon-rehearsal-20261005t184922z'
ORIGIN = 'https://38.247.146.17.nip.io:18443'


def rehearsal_project(identity):
    """Candidates have separate Compose projects, exclusively on port 18443."""
    validation = identity.get('validation_id')
    expected = PROJECT
    if 'validation_id' in identity:
        if not isinstance(validation, str) or not re.fullmatch(r'[a-f0-9]{32}', validation):
            raise ValueError('Invalid release validation identity')
        if not re.fullmatch(r'[a-f0-9]{40}', identity.get('infrastructure_revision', '')):
            raise ValueError('Candidate requires its pinned infrastructure revision')
        expected = 'backgammon-candidate-' + validation
    if identity.get('project') != expected or identity.get('origin') != ORIGIN:
        raise ValueError('Unexpected browser rehearsal target')
    return expected


def fresh_database_context(session_id, integrations=False):
    if not isinstance(session_id, str) or not re.fullmatch(r'[a-f0-9]{32}', session_id):
        raise ValueError('Expected the prepared browser session identifier')
    return {'purpose': 'browser-e2e',
            'databases': {kind: f'backgammon_{kind}_e2e_{session_id[:12]}'
                          for kind in ('game', 'tournaments')},
            'redis_databases': {'game': 10, 'tournaments': 11} if integrations else {'game': 8, 'tournaments': 9}}


def require_fresh_database_context(identity):
    rehearsal_project(identity)
    expected = fresh_database_context(identity.get('session_id'), integrations='integrations' in identity)
    if identity.get('database_context') != expected:
        raise ValueError('Run fresh-databases before using the browser rehearsal')
    return expected


def require_browser_database_context(identity):
    """Copied candidates are opt-in; the existing fresh-database guard stays strict."""
    if identity.get('database_context', {}).get('purpose') != 'copied-browser-e2e':
        return require_fresh_database_context(identity)
    rehearsal_project(identity)
    validation = identity.get('validation_id', '')
    context = identity['database_context']
    if (not re.fullmatch(r'[a-f0-9]{32}', validation)
            or not re.fullmatch(r'[a-f0-9]{32}', identity.get('session_id', ''))
            or identity.get('load_cleanup_version') != 1
            or not re.fullmatch(r'[a-f0-9]{40}', identity.get('tools_revision', ''))
            or set(context) != {'purpose', 'databases', 'markers', 'redis_databases'}
            or set(context['databases']) != {'game', 'tournaments', 'analysis'}
            or set(context['markers']) != set(context['databases'])
            or set(context['redis_databases']) != {'game', 'tournaments'}):
        raise ValueError('Copied load requires a prepared candidate and scoped cleanup')
    for kind, name in context['databases'].items():
        restored = bool(re.fullmatch(r'bgv_restore_' + validation[:12] + r'_[a-z0-9_]{1,22}', name))
        marker = context['markers'][kind]
        if restored:
            if marker != f'backgammon-validation:{validation}:restore:{name}':
                raise ValueError('Copied database restoration marker differs')
        elif name != 'backgammon_' + kind or marker is not None:
            raise ValueError('Unexpected copied candidate database')
    if any(type(value) is not int or not 0 <= value <= 15 for value in context['redis_databases'].values()):
        raise ValueError('Invalid copied candidate Redis database')
    if len(set(context['redis_databases'].values())) != 2:
        raise ValueError('Game and tournament Redis databases must differ')
    return context


def require_copied_network_context(identity, network, containers, volumes):
    """Permit a candidate bridge with outbound access only with verified ownership."""
    project = rehearsal_project(identity)
    name = project + '_application'
    labels = network.get('Labels') or {}
    if ('validation_id' not in identity or network.get('Name') != name
            or network.get('Driver') != 'bridge' or type(network.get('Internal')) is not bool
            or not re.fullmatch(r'[a-f0-9]{64}', network.get('Id', ''))
            or labels.get('com.docker.compose.project') != project
            or labels.get('com.docker.compose.network') != 'application'):
        raise ValueError('Expected the candidate-owned application bridge')
    members = network.get('Containers') or {}
    observed = {value['Id']: value for value in containers}
    if not members or not set(members) <= set(observed):
        raise ValueError('Incomplete candidate network inventory')
    storage = {}
    for identifier, value in observed.items():
        labels = value.get('Config', {}).get('Labels') or {}
        service = labels.get('com.docker.compose.service')
        if labels.get('com.docker.compose.project') != project or not service:
            raise ValueError('Another project uses the candidate network or data volume')
        attachments = value.get('NetworkSettings', {}).get('Networks', {})
        if identifier in members:
            allowed = {name}
            if service in ('tournaments-api', 'push-worker'):
                allowed.add(project + '_integrations_egress')
            if (name not in attachments or set(attachments) - allowed
                    or attachments[name]['NetworkID'] != network['Id']):
                raise ValueError('Candidate container is attached to another network')
        for mapping in (value.get('NetworkSettings', {}).get('Ports') or {},
                        value.get('HostConfig', {}).get('PortBindings') or {}):
            for bindings in mapping.values():
                for binding in bindings or []:
                    if service in ('postgres', 'redis') or binding.get('HostIp') not in ('127.0.0.1', '::1'):
                        raise ValueError('Candidate ports must be local and database/cache ports unpublished')
        if service in ('postgres', 'redis') and identifier in members:
            destination = '/var/lib/postgresql/data' if service == 'postgres' else '/data'
            mounts = [mount for mount in value.get('Mounts', []) if mount['Destination'] == destination]
            expected = project + '_' + service + '_data'
            if (service in storage or len(mounts) != 1 or mounts[0].get('Type') != 'volume'
                    or mounts[0].get('Name') != expected or mounts[0].get('RW') is not True):
                raise ValueError('Candidate database/cache data must use its own named volume')
            volume = volumes.get(expected, {})
            labels = volume.get('Labels') or {}
            if (volume.get('Name') != expected or volume.get('Driver') != 'local'
                    or labels.get('com.docker.compose.project') != project
                    or labels.get('com.docker.compose.volume') != service + '_data'):
                raise ValueError('Candidate data volume ownership differs')
            storage[service] = expected
    if set(storage) != {'postgres', 'redis'}:
        raise ValueError('Candidate database/cache network inventory is incomplete')
    context = {'name': name, 'id': network['Id'], 'internal': network['Internal'], 'data_volumes': storage}
    if 'network_context' in identity and identity['network_context'] != context:
        raise ValueError('Prepared candidate network or data volume identity changed')
    return context


def require_copied_network_config(identity, config):
    """Keep the observed network mode and volumes when Compose recreates only APIs."""
    project = rehearsal_project(identity)
    context = identity.get('network_context') or {}
    network = config.get('networks', {}).get('application', {})
    if ('validation_id' not in identity or context.get('name') != project + '_application'
            or not re.fullmatch(r'[a-f0-9]{64}', context.get('id', ''))
            or type(context.get('internal')) is not bool or config.get('name') != project
            or network.get('name') != context['name'] or network.get('external', False)
            or network.get('driver', 'bridge') != 'bridge'
            or network.get('internal', False) is not context['internal']):
        raise ValueError('Compose differs from the observed candidate network')
    for service, item in config['services'].items():
        for port in item.get('ports', []):
            if service in ('postgres', 'redis') or port.get('host_ip') not in ('127.0.0.1', '::1'):
                raise ValueError('Candidate ports must be local and database/cache ports unpublished')
    for service in ('postgres', 'redis'):
        expected = project + '_' + service + '_data'
        destination = '/var/lib/postgresql/data' if service == 'postgres' else '/data'
        symbolic = service + '_data'
        mounts = [mount for mount in config['services'][service].get('volumes', [])
                  if mount.get('target') == destination]
        volume = config.get('volumes', {}).get(symbolic, {})
        if (context.get('data_volumes', {}).get(service) != expected or len(mounts) != 1
                or mounts[0].get('type') != 'volume' or mounts[0].get('source') != symbolic
                or mounts[0].get('read_only', False)
                or volume.get('name') != expected or volume.get('external', False)
                or volume.get('driver', 'local') != 'local'):
            raise ValueError('Compose would change candidate database/cache storage')
    return context
