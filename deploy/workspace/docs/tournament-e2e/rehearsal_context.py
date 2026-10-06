"""Database identity shared by host provisioning and the container-side audit."""
import re

PROJECT = 'backgammon-rehearsal-20261005t184922z'
ORIGIN = 'https://38.247.146.17.nip.io:18443'


def fresh_database_context(session_id, integrations=False):
    if not isinstance(session_id, str) or not re.fullmatch(r'[a-f0-9]{32}', session_id):
        raise ValueError('Expected the prepared browser session identifier')
    return {'purpose': 'browser-e2e',
            'databases': {kind: f'backgammon_{kind}_e2e_{session_id[:12]}'
                          for kind in ('game', 'tournaments')},
            'redis_databases': {'game': 10, 'tournaments': 11} if integrations else {'game': 8, 'tournaments': 9}}


def require_fresh_database_context(identity):
    if identity.get('project') != PROJECT or identity.get('origin') != ORIGIN:
        raise ValueError('Unexpected browser rehearsal target')
    expected = fresh_database_context(identity.get('session_id'), integrations='integrations' in identity)
    if identity.get('database_context') != expected:
        raise ValueError('Run fresh-databases before using the browser rehearsal')
    return expected
