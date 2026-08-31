from django.contrib.auth.models import User
from django.db import models


class LinkedIdentity(models.Model):
    """
    Maps an issuer's opaque external id onto a local user.

    Identity is matched on `(issuer, external_id)` and never on username: a local backgammon
    account and a linked account that happen to share a name stay distinct accounts.
    """

    issuer = models.CharField(max_length=32)
    external_id = models.CharField(max_length=64)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='linked_identities')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['issuer', 'external_id'], name='unique_issuer_external_id'),
        ]

    def __str__(self):
        return f"{self.issuer}:{self.external_id} -> {self.user.username}"


class RedeemedTicket(models.Model):
    """
    Tickets that have been spent.

    Single use is enforced *here*, at the verifier, because this is the only side that observes a
    redemption. The issuer's own record of what it minted is an audit log, not a gate. The unique
    constraint on `jti` is the whole mechanism: redemption inserts a row inside the same
    transaction that provisions the room, so a replay loses the race atomically.
    """

    jti = models.UUIDField(unique=True)
    issuer = models.CharField(max_length=32)
    redeemed_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"{self.issuer} ticket {self.jti}"


class TournamentLink(models.Model):
    """
    One game room per fixture of an external tournament.

    Both players of a fixture redeem separate tickets; the first to arrive creates the room and the
    second finds it through this row, which is what puts them in the same game.
    """

    issuer = models.CharField(max_length=32)
    tournament_id = models.IntegerField()
    fixture_id = models.IntegerField()
    room = models.OneToOneField('game.GameRoom', on_delete=models.CASCADE, related_name='tournament_link')
    seat_p1_color = models.CharField(max_length=5, default='white')

    # 'pending' (nothing to report yet) -> 'queued' (a result is built and waiting on delivery)
    # -> 'delivered'. The body is frozen into `result_body` the moment the outcome is known, so a
    # retry hours later re-sends what actually happened rather than re-deriving it from state that
    # has moved on. Only the timestamp and nonce are minted fresh per attempt.
    result_status = models.CharField(max_length=16, default='pending')
    result_body = models.JSONField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['issuer', 'fixture_id'], name='unique_issuer_fixture'),
        ]

    def color_for_seat(self, seat):
        """Return the room colour belonging to `seat` ('p1' or 'p2')."""
        other = 'black' if self.seat_p1_color == 'white' else 'white'
        return self.seat_p1_color if seat == 'p1' else other

    def __str__(self):
        return f"{self.issuer} fixture {self.fixture_id} -> room {self.room_id}"
