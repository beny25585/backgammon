import logging

from django.db import transaction
from django.utils import timezone
from datetime import timedelta

from .link.models import TournamentLink
from .link.outbox import STATUS_CANCELLED, enqueue_forfeit, enqueue_result
from .models import GameRoom

logger = logging.getLogger(__name__)


def expire_waiting_rooms(minutes: int = 60) -> int:
    """Expire stale waiting rooms owned by the game service.

    Tournament entry deadlines belong to the tournaments service. In particular,
    its paused deadlines must not be bypassed by this older hourly cleanup path.
    Direct-play links and unlinked rooms retain their existing expiry behavior.
    Returns the number of rooms actually closed after rechecking under lock.
    """
    cutoff = timezone.now() - timedelta(minutes=minutes)
    stale_ids = list(
        GameRoom.objects.filter(status="waiting", updated_at__lt=cutoff).exclude(
            tournament_link__tournament_id__gt=0,
        ).values_list("pk", flat=True)
    )
    return sum(_expire_waiting_room(room_id, cutoff) for room_id in stale_ids)


def _expire_waiting_room(room_id, cutoff) -> bool:
    """Recheck ownership, activity and state before closing one candidate."""
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.status != "waiting" or room.updated_at >= cutoff:
            return False
        link = TournamentLink.objects.select_for_update().filter(room_id=room.pk).first()
        if link is not None and link.tournament_id > 0:
            logger.debug('event=waiting_expiry_skipped room_id=%s tournament_id=%s fixture_id=%s reason=tournament_owned',
                         room.pk, link.tournament_id, link.fixture_id)
            return False

        seated = list(room.players.all())
        room.status = "cancelled"
        room.save(update_fields=["status", "updated_at"])

        if link is None:
            transaction.on_commit(lambda: logger.info(
                'event=waiting_room_expired room_id=%s linked=False', room.pk,
            ))
            return True
        if len(seated) == 1:
            enqueue_forfeit(link, room, seated[0].color)
        else:
            enqueue_result(link, None, room, STATUS_CANCELLED, end_reason="expired")
        transaction.on_commit(lambda: logger.info(
            'event=waiting_room_expired room_id=%s linked=True fixture_id=%s '
            'tournament_id=%s outcome=%s', room.pk, link.fixture_id, link.tournament_id,
            'forfeit' if len(seated) == 1 else 'cancelled',
        ))
        return True
