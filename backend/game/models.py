import uuid
from django.db import models
from django.contrib.auth.models import User


def generate_room_code():
    return uuid.uuid4().hex[:6].upper()


class Player(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name='player')
    nickname = models.CharField(max_length=30, blank=True)
    rating = models.IntegerField(default=1000)
    wins = models.IntegerField(default=0)
    losses = models.IntegerField(default=0)
    win_streak = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.nickname or self.user.username


class GameRoom(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=6, unique=True)
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    target_points = models.IntegerField(default=7)
    time_control = models.CharField(max_length=20, default='normal')
    status = models.CharField(max_length=20, default='waiting')
    state = models.JSONField(default=dict)
    last_sequence = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Room {self.code} ({self.status})"


class RoomPlayer(models.Model):
    room = models.ForeignKey(
        GameRoom, on_delete=models.CASCADE, related_name='players')
    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name='room_memberships')
    color = models.CharField(max_length=5, choices=[
                             ('white', 'White'), ('black', 'Black')])
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['room', 'color'], name='unique_room_color'),
            models.UniqueConstraint(
                fields=['room', 'player'], name='unique_room_player'),
        ]

    def __str__(self):
        return f"{self.player} ({self.color}) in {self.room.code}"


class GameState(models.Model):
    room = models.OneToOneField(GameRoom, on_delete=models.CASCADE)
    state_data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"GameState for {self.room.code}"


class Match(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(GameRoom, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name='matches')
    created_at = models.DateTimeField(auto_now_add=True)
    duration_seconds = models.IntegerField(null=True, blank=True)
    white_player = models.ForeignKey(
        Player, on_delete=models.SET_NULL, null=True, related_name='match_wins_white')
    black_player = models.ForeignKey(
        Player, on_delete=models.SET_NULL, null=True, related_name='match_wins_black')
    match_type = models.CharField(max_length=10, default='online')
    target_points = models.IntegerField(default=7)
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    winner = models.CharField(max_length=5, null=True, blank=True)
    games = models.JSONField(default=list)
    end_reason = models.CharField(max_length=20, null=True, blank=True)
    first_player = models.CharField(max_length=5, null=True, blank=True)
    opening_roll = models.JSONField(null=True, blank=True)
    final_cube = models.IntegerField(default=1)
    hits = models.IntegerField(default=0)
    doubles_offered = models.IntegerField(default=0)
    doubles_accepted = models.IntegerField(default=0)
    clock_remaining = models.JSONField(null=True, blank=True)

    def __str__(self):
        return f"Match {self.id} ({self.white_score}-{self.black_score})"


class GameEvent(models.Model):
    EVENT_TYPES = [
        ('roll', 'Roll'),
        ('move', 'Move'),
        ('undo', 'Undo'),
        ('end_turn', 'End turn'),
        ('double', 'Double'),
        ('double_response', 'Double response'),
        ('resign', 'Resign'),
        ('next_game', 'Next game'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(
        GameRoom, on_delete=models.CASCADE, related_name='events')
    player = models.ForeignKey(
        RoomPlayer, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    sequence = models.IntegerField(default=0)
    event_type = models.CharField(max_length=20, choices=EVENT_TYPES)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sequence']

    def __str__(self):
        return f"{self.event_type} #{self.sequence} in {self.room.code}"


class Task(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("done", "Done"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(
        max_length=200, help_text="Callable path, e.g. module.func")
    args = models.JSONField(default=list, blank=True)
    kwargs = models.JSONField(default=dict, blank=True)
    run_at = models.DateTimeField(
        null=True, blank=True, help_text="When to run (UTC)")
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default="pending")
    attempts = models.IntegerField(default=0)
    max_attempts = models.IntegerField(default=3)
    last_error = models.TextField(null=True, blank=True)
    result = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-run_at", "-created_at"]

    def __str__(self):
        return f"Task {self.name} ({self.status})"


class Tournament(models.Model):
    STATUS_CHOICES = [
        ("scheduled", "Scheduled"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]
    TIME_CHOICES = [
        ("none", "None"),
        ("fast", "Fast"),
        ("normal", "Normal"),
        ("slow", "Slow"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=80)
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default="scheduled")
    starts_at = models.DateTimeField()
    min_players = models.PositiveSmallIntegerField(default=6)
    max_players = models.PositiveSmallIntegerField(null=True, blank=True)
    target_points = models.PositiveSmallIntegerField(default=5)
    time_control = models.CharField(
        max_length=20, choices=TIME_CHOICES, default="normal")
    # need to remove the null option in prod
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_tournaments")
    champion = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="tournament_championships"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at"]

    def __str__(self):
        return f"Tournament {self.name} ({self.status})"


class TournamentSignup(models.Model):
    tournament = models.ForeignKey(
        Tournament, on_delete=models.CASCADE, related_name="signups")
    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="tournament_signups")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "player"], name="unique_tournament_player"),
        ]
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.player} in {self.tournament.name}"


class BracketMatch(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("playing", "Playing"),
        ("completed", "Completed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tournament = models.ForeignKey(
        Tournament, on_delete=models.CASCADE, related_name="matches")
    round_number = models.PositiveSmallIntegerField()
    slot = models.PositiveSmallIntegerField()
    white_player = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="tournament_matches_as_white"
    )
    black_player = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="tournament_matches_as_black"
    )
    room = models.ForeignKey(
        GameRoom, null=True, blank=True, on_delete=models.SET_NULL, related_name="bracket_match"
    )
    winner = models.ForeignKey(
        Player, null=True, blank=True, on_delete=models.SET_NULL, related_name="tournament_match_wins"
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default="pending")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "round_number", "slot"], name="unique_tournament_round_slot"
            ),
        ]
        ordering = ["round_number", "slot"]

    def __str__(self):
        return f"R{self.round_number} S{self.slot} ({self.status}) — {self.tournament.name}"
