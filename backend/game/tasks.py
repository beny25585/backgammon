from django.utils import timezone
from datetime import timedelta

from .models import GameRoom


def expire_waiting_rooms(minutes: int = 60) -> int:
    """Expire waiting GameRoom rows older than `minutes`.

    Returns the number of rooms expired.
    """
    cutoff = timezone.now() - timedelta(minutes=minutes)
    qs = GameRoom.objects.filter(status="waiting", updated_at__lt=cutoff)
    count = qs.count()
    qs.update(status="cancelled")
    return count
