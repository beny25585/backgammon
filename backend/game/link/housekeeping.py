"""
Scheduled cleanup for the link (plan §8).

`RedeemedTicket` is the single-use gate: a row here means "this jti has been spent", and the unique
constraint on it is what makes a replay lose atomically. Deleting rows from a table that exists to
stop replays deserves an argument, so here it is.

A ticket is refused by `verify_ticket` once it is past its expiry — twice over, by `max_age` on the
signature and by the `exp` claim — *before* redemption is ever considered. So a spent ticket whose
`expires_at` has passed can no longer be presented successfully whether or not this server still
remembers spending it. Forgetting it is therefore free; forgetting it any earlier would not be.
"""

from django.utils import timezone

from .models import RedeemedTicket


def purge_redeemed_tickets(now=None):
    """
    Delete spent tickets that are past their own expiry. Returns the number deleted.
    """
    now = now or timezone.now()
    return RedeemedTicket.objects.filter(expires_at__lt=now).delete()[0]
