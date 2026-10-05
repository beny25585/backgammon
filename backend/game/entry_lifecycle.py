"""Close rooms that never reached their first full human presence."""
from datetime import timedelta
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import GameRoom

ENTRY_TIMEOUT = timedelta(minutes=10)


def active_room_for(player, exclude=None):
    """Caller holds a transaction; serialize admission on the player's user row."""
    from django.contrib.auth import get_user_model
    get_user_model().objects.select_for_update().get(pk=player.user_id)
    rooms = GameRoom.objects.filter(players__player=player, status__in=['waiting', 'playing'])
    if exclude is not None:
        rooms = rooms.exclude(pk=exclude)
    for room in rooms:
        if expire_unstarted_room(room.pk) != 'cancelled':
            return room
    return None


def entry_deadline(room):
    return (room.state or {}).get('entryDeadline', (room.created_at + ENTRY_TIMEOUT).timestamp())


@transaction.atomic
def expire_unstarted_room(room_id, now=None):
    now = now or timezone.now()
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    from .scheduling import check_ownership
    check_ownership(lock=True)
    if room is None:
        return 'missing'
    if room.status not in ('waiting', 'playing'):
        return room.status
    meta = room.state or {}
    if meta.get('ai') or (meta.get('presence') or {}).get('everBothConnected'):
        return 'started'
    from .link.models import TournamentLink
    link = TournamentLink.objects.filter(room=room).first()
    if link is not None and link.tournament_id > 0:
        return 'waiting'
    if now.timestamp() < entry_deadline(room):
        return 'waiting'
    room.status = 'cancelled'
    room.save(update_fields=['status', 'updated_at'])
    from .link.outbox import enqueue_result, STATUS_CANCELLED
    if link:
        enqueue_result(link, None, room, STATUS_CANCELLED, end_reason='entry_timeout')
    def notify():
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f'game_{room.id}', {'type': 'room_expired'})
    transaction.on_commit(notify)
    return 'cancelled'


def expire_unstarted_rooms(limit=50):
    if limit < 1:
        raise ValueError('limit must be positive')
    now = timezone.now()
    ids = GameRoom.objects.filter(status__in=['waiting', 'playing']).exclude(
        tournament_link__tournament_id__gt=0
    ).filter(
        Q(state__ai__isnull=True) | Q(state__ai=False) | Q(state__ai=None),
        Q(state__presence__everBothConnected__isnull=True)
        | Q(state__presence__everBothConnected=False) | Q(state__presence__everBothConnected=None),
    ).filter(
        Q(state__entryDeadline__lte=now.timestamp())
        | Q(state__entryDeadline__isnull=True, created_at__lte=now - ENTRY_TIMEOUT)
    ).order_by('created_at', 'pk').values_list('pk', flat=True)[:limit]
    return sum(expire_unstarted_room(pk, now) == 'cancelled' for pk in list(ids))
