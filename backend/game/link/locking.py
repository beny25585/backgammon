"""Lock a linked room before its link, matching game and presence operations."""
from django.db import connection

from game.models import GameRoom

from .models import TournamentLink


def lock_linked_room(room_id, **link_filters):
    """Caller owns the transaction; related state must be locked after the room.

    Avoid a joined FOR UPDATE: it can acquire the link before the room while
    another operation holds the room and waits for the link. Recheck the link
    after acquiring the room lock, including its current room assignment.
    """
    if not connection.in_atomic_block:
        raise RuntimeError('Linked room locks require an atomic transaction')
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if room is None:
        return None, None
    link = TournamentLink.objects.select_for_update().filter(
        room_id=room.pk, **link_filters,
    ).first()
    return room, link
