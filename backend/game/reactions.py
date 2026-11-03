"""Transient player reactions, independent of gameplay state and history."""

import time
import uuid

from channels.db import database_sync_to_async
from django.conf import settings
from redis import asyncio as redis

from .models import GameRoom
from .presence import needs_admin_adjudication


REACTION_IDS = frozenset({
    'good_luck', 'nice_move', 'thanks', 'well_played', 'good_game',
    'thumbs_up', 'clap', 'smile', 'thinking', 'sweat_smile', 'dice',
})
REACTION_DURATION_MS = 4000
REACTION_COOLDOWN_MS = 3000


class ReactionError(Exception):
    def __init__(self, reason, *, retry_after_ms=None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after_ms = retry_after_ms


@database_sync_to_async
def get_reaction_sender(room_id, user_id, connection_color):
    """Recheck current membership without changing presence or game timers."""
    room = GameRoom.objects.filter(pk=room_id).first()
    if (
        room is None
        or room.status != 'playing'
        or (room.state or {}).get('ai')
        or needs_admin_adjudication(room)
    ):
        return None
    seats = dict(room.players.values_list('color', 'player__user_id'))
    if (
        set(seats) != {'white', 'black'}
        or seats['white'] == seats['black']
        or connection_color not in seats
        or seats[connection_color] != user_id
    ):
        return None
    return connection_color


# SET NX and its TTL check must be atomic across sockets and workers. The
# expiring key stores no message and is never read on a later connection.
COOLDOWN_SCRIPT = """
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then
    return 0
end
return math.max(1, redis.call('PTTL', KEYS[1]))
"""


def _cooldown_client():
    layer = getattr(settings, 'CHANNEL_LAYERS', {}).get('default', {})
    if layer.get('BACKEND') != 'channels_redis.core.RedisChannelLayer':
        raise ReactionError('unavailable')
    config = layer.get('CONFIG', {})
    hosts = config.get('hosts', [])
    if not hosts:
        raise ReactionError('unavailable')
    # All workers choose the same server even if Channels shards its queues.
    address = hosts[0]
    options = {'socket_connect_timeout': 1, 'socket_timeout': 1}
    if isinstance(address, str):
        client = redis.Redis.from_url(address, **options)
    elif isinstance(address, (list, tuple)) and len(address) == 2:
        client = redis.Redis(host=address[0], port=address[1], **options)
    elif isinstance(address, dict):
        host_options = dict(address)
        url = host_options.pop('address', None)
        if url:
            client = redis.Redis.from_url(url, **{**options, **host_options})
        else:
            client = redis.Redis(**{**options, **host_options})
    else:
        raise ReactionError('unavailable')
    return client, config.get('prefix', 'asgi')


async def reserve_reaction_cooldown(room_id, user_id):
    client, prefix = _cooldown_client()
    key = f'{prefix}:player-reactions:v1:{uuid.UUID(str(room_id))}:{int(user_id)}'
    try:
        retry_after_ms = await client.eval(
            COOLDOWN_SCRIPT, 1, key, REACTION_COOLDOWN_MS,
        )
        return min(REACTION_COOLDOWN_MS, max(0, int(retry_after_ms)))
    finally:
        await client.close()


async def create_player_reaction(room_id, user_id, connection_color, payload):
    if not isinstance(payload, dict):
        raise ReactionError('invalid')
    reaction_id = payload.get('reactionId')
    if not isinstance(reaction_id, str) or reaction_id not in REACTION_IDS:
        raise ReactionError('invalid')
    color = await get_reaction_sender(room_id, user_id, connection_color)
    if color is None:
        raise ReactionError('unavailable')
    retry_after_ms = await reserve_reaction_cooldown(room_id, user_id)
    if retry_after_ms:
        raise ReactionError('cooldown', retry_after_ms=retry_after_ms)
    return {
        'id': str(uuid.uuid4()),
        'roomId': str(room_id),
        'reactionId': reaction_id,
        'color': color,
        'expiresAt': int(time.time() * 1000) + REACTION_DURATION_MS,
        'remainingMs': REACTION_DURATION_MS,
        'cooldownMs': REACTION_COOLDOWN_MS,
    }
