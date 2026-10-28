"""Read-only tournament snapshots and a shared two-connection spectator limit."""

import copy
import time
import uuid

from django.conf import settings
from django.core import signing
from redis import asyncio as redis

from .link.models import TournamentLink
from .models import GameRoom, GameState


SPECTATOR_SALT = 'gamelink.spectator.v1'
TICKET_SECONDS = 120
LEASE_SECONDS = 45
MAX_SPECTATORS = 2


class SpectatorError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def ticket_secrets():
    return [secret for secret in getattr(settings, 'GAMELINK_TICKET_SECRETS', []) if secret]


def verify_spectator_ticket(token, room_id):
    if not isinstance(token, str) or not token or len(token) > 3072:
        raise SpectatorError('forbidden')
    secrets = ticket_secrets()
    if not secrets:
        raise SpectatorError('unavailable')
    claims = None
    for secret in secrets:
        try:
            claims = signing.loads(token, key=secret, salt=SPECTATOR_SALT,
                                   max_age=TICKET_SECONDS)
            break
        except signing.SignatureExpired:
            raise SpectatorError('expired') from None
        except signing.BadSignature:
            continue
    if not isinstance(claims, dict):
        raise SpectatorError('forbidden')
    if (type(claims.get('v')) is not int or claims['v'] != 1
            or claims.get('role') != 'spectator'
            or claims.get('iss') not in getattr(settings, 'GAMELINK_ACCEPTED_ISSUERS', [])
            or claims.get('aud') != getattr(settings, 'GAMELINK_ISSUER', None)):
        raise SpectatorError('forbidden')
    for name in ('trn', 'fix', 'iat', 'exp'):
        if type(claims.get(name)) is not int or claims[name] <= 0:
            raise SpectatorError('forbidden')
    try:
        for name in ('room', 'sub', 'jti'):
            if not isinstance(claims.get(name), str):
                raise ValueError()
            uuid.UUID(claims[name])
        if uuid.UUID(claims['room']) != uuid.UUID(str(room_id)):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise SpectatorError('forbidden') from None
    now = int(time.time())
    if claims['exp'] <= now:
        raise SpectatorError('expired')
    if claims['iat'] > now + 5 or not 0 < claims['exp'] - claims['iat'] <= TICKET_SECONDS:
        raise SpectatorError('forbidden')
    return claims


def renew_spectator_ticket(claims):
    secrets = ticket_secrets()
    if not secrets:
        raise SpectatorError('unavailable')
    now = int(time.time())
    renewed = {**claims, 'iat': now, 'exp': now + TICKET_SECONDS,
               'jti': str(uuid.uuid4())}
    return signing.dumps(renewed, key=secrets[0], salt=SPECTATOR_SALT, compress=True)


# An allowlist prevents undo snapshots, dice-service seeds, internal notes and
# future private state fields from silently becoming part of the watch protocol.
PUBLIC_STATE_KEYS = (
    'gameId', 'points', 'bar', 'home', 'turn', 'dice', 'remaining', 'phase',
    'cube', 'cubeOwner', 'doublingEnabled', 'doubleOfferedBy', 'winner',
    'winType', 'openingRoll', 'lastMove', 'version', 'clock', 'turnStartedAt',
    'crawfordGame', 'gameFormat', 'matchScored', 'gameEndReason',
)


def public_state(state, *, version=None):
    state = state if isinstance(state, dict) else {}
    result = {key: copy.deepcopy(state[key]) for key in PUBLIC_STATE_KEYS if key in state}
    if version is not None:
        result['version'] = version
    return result


def spectator_snapshot(claims):
    """Read a coherent room/state pair without creating seats or touching clocks."""
    if not getattr(settings, 'GAMELINK_ENABLED', False):
        raise SpectatorError('unavailable')
    link = TournamentLink.objects.filter(
        issuer=claims['iss'], tournament_id=claims['trn'],
        fixture_id=claims['fix'], room_id=claims['room'],
    ).select_related('room__gamestate').first()
    if link is None:
        raise SpectatorError('forbidden')
    room = link.room
    if room.players.filter(
        player__user__linked_identities__issuer=claims['iss'],
        player__user__linked_identities__external_id=claims['sub'],
    ).exists():
        raise SpectatorError('forbidden')
    try:
        stored = room.gamestate.state_data
    except GameState.DoesNotExist:
        raise SpectatorError('unavailable') from None
    names = {seat.color: str(seat.player)
             for seat in room.players.select_related('player__user')}
    return {
        'status': room.status,
        'payload': public_state(stored, version=room.last_sequence),
        'meta': {
            'whiteName': names.get('white', ''),
            'blackName': names.get('black', ''),
            'targetPoints': room.target_points,
            'matchScore': {'white': room.white_score, 'black': room.black_score},
            'timeControl': room.time_control,
        },
    }


def spectator_revision(room_id):
    """Bounded recovery for at-most-once group delivery; no board/history load."""
    revision = GameRoom.objects.filter(pk=room_id).values(
        'status', 'last_sequence', 'white_score', 'black_score',
    ).first()
    if revision is None:
        raise SpectatorError('unavailable')
    return revision


# Redis TIME makes every worker use the same lease clock. Expired owners can
# neither renew nor continue forwarding; ZREM releases only this socket's UUID.
LEASE_SCRIPT = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local key, operation, owner = KEYS[1], ARGV[1], ARGV[2]
local duration, maximum = tonumber(ARGV[3]), tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if operation == 'release' then
    return redis.call('ZREM', key, owner)
end
local existing = redis.call('ZSCORE', key, owner)
if operation == 'reserve' then
    if existing then return tonumber(existing) end
    if redis.call('ZCARD', key) >= maximum then return 0 end
elseif not existing then
    return 0
elseif operation == 'valid' then
    return tonumber(existing)
end
local deadline = now + duration
redis.call('ZADD', key, deadline, owner)
redis.call('PEXPIRE', key, duration)
return deadline
"""


class SpectatorLeases:
    def __init__(self, room_id, owner):
        layer = getattr(settings, 'CHANNEL_LAYERS', {}).get('default', {})
        if layer.get('BACKEND') != 'channels_redis.core.RedisChannelLayer':
            raise SpectatorError('unavailable')
        config = layer.get('CONFIG', {})
        hosts = config.get('hosts', [])
        if not hosts:
            raise SpectatorError('unavailable')
        # Deliberately select the same first server on every worker, even when
        # Channels itself shards its queues over several configured servers.
        address = hosts[0]
        options = {'socket_connect_timeout': 2, 'socket_timeout': 2}
        if isinstance(address, str):
            self.client = redis.Redis.from_url(address, **options)
        elif isinstance(address, (list, tuple)) and len(address) == 2:
            self.client = redis.Redis(host=address[0], port=address[1], **options)
        elif isinstance(address, dict):
            host_options = {**address}
            url = host_options.pop('address', None)
            if url:
                self.client = redis.Redis.from_url(url, **{**options, **host_options})
            else:
                self.client = redis.Redis(**{**options, **host_options})
        else:
            raise SpectatorError('unavailable')
        prefix = config.get('prefix', 'asgi')
        self.key = f'{prefix}:spectators:v1:{uuid.UUID(str(room_id))}'
        self.owner = owner

    async def apply(self, operation):
        return bool(await self.client.eval(
            LEASE_SCRIPT, 1, self.key, operation, self.owner,
            LEASE_SECONDS * 1000, MAX_SPECTATORS,
        ))

    async def close(self):
        await self.client.close()
