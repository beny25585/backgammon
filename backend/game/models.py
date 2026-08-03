import uuid
from django.db import models
from django.contrib.auth.models import User


def generate_room_code():
    return uuid.uuid4().hex[:6].upper()


class Player(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='player')
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
    time_control = models.CharField(max_length=20, default='3+10')
    status = models.CharField(max_length=20, default='waiting')
    state = models.JSONField(default=dict)
    last_sequence = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Room {self.code} ({self.status})"


class RoomPlayer(models.Model):
    room = models.ForeignKey(GameRoom, on_delete=models.CASCADE, related_name='players')
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='room_memberships')
    color = models.CharField(max_length=5, choices=[('white', 'White'), ('black', 'Black')])
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['room', 'color'], name='unique_room_color'),
            models.UniqueConstraint(fields=['room', 'player'], name='unique_room_player'),
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
    room = models.ForeignKey(GameRoom, on_delete=models.SET_NULL, null=True, blank=True, related_name='matches')
    created_at = models.DateTimeField(auto_now_add=True)
    duration_seconds = models.IntegerField(null=True, blank=True)
    white_player = models.ForeignKey(Player, on_delete=models.SET_NULL, null=True, related_name='match_wins_white')
    black_player = models.ForeignKey(Player, on_delete=models.SET_NULL, null=True, related_name='match_wins_black')
    match_type = models.CharField(max_length=10, default='online')
    target_points = models.IntegerField(default=7)
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    winner = models.CharField(max_length=5, null=True, blank=True)
    games = models.JSONField(default=list)

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
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(GameRoom, on_delete=models.CASCADE, related_name='events')
    player = models.ForeignKey(RoomPlayer, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    sequence = models.IntegerField(default=0)
    event_type = models.CharField(max_length=20, choices=EVENT_TYPES)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sequence']

    def __str__(self):
        return f"{self.event_type} #{self.sequence} in {self.room.code}"
