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
