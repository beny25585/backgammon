from django.db import transaction
from django.utils import timezone
from datetime import timedelta

from .link.models import TournamentLink
from .link.outbox import STATUS_CANCELLED, enqueue_forfeit, enqueue_result
from .models import GameRoom


def expire_waiting_rooms(minutes: int = 60) -> int:
    """Expire waiting GameRoom rows older than `minutes`.

    A room belonging to an external tournament is reported before it is closed, because expiry is
    the only signal the tournament will ever get that the fixture was abandoned. Rooms that belong
    to nobody are closed in one bulk update, exactly as before.

    Returns the number of rooms expired.
    """
    cutoff = timezone.now() - timedelta(minutes=minutes)
    stale_ids = list(
        GameRoom.objects.filter(status="waiting", updated_at__lt=cutoff).values_list("pk", flat=True)
    )
    if not stale_ids:
        return 0

    links = list(TournamentLink.objects.filter(room_id__in=stale_ids))
    for link in links:
        _expire_linked_room(link)

    linked_ids = {link.room_id for link in links}
    GameRoom.objects.filter(
        pk__in=[room_id for room_id in stale_ids if room_id not in linked_ids]
    ).update(status="cancelled")

    return len(stale_ids)


def _expire_linked_room(link) -> None:
    """Close one expired tournament room, reporting its fixture before it goes.

    Exactly one seat filled is the abandonment this exists for: one player opened their link and
    the other never did, so the absent one forfeits and the fixture completes (plan §9 decision 2).
    Any other shape has no basis for choosing a winner and releases the fixture back to manual
    scoring instead.

    Note that "neither player arrived" is not one of those shapes, and cannot be: the room and its
    link are created inside the same transaction that seats the first player, so a fixture nobody
    opened has no room here at all. That case is the tournaments server's to time out.
    """
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().get(pk=link.room_id)
        if room.status != "waiting":
            # Somebody started or cancelled it between the sweep's query and this lock.
            return

        seated = list(room.players.all())
        room.status = "cancelled"
        room.save(update_fields=["status", "updated_at"])

        link.refresh_from_db()
        if len(seated) == 1:
            enqueue_forfeit(link, room, seated[0].color)
        else:
            enqueue_result(link, None, room, STATUS_CANCELLED, end_reason="expired")
