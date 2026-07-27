import uuid
from django.db import models
from django.contrib.auth.models import User


def generate_room_code():
    return uuid.uuid4().hex[:6].upper()


class GameRoom(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=6, unique=True)
    white_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='white_games')
    black_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='black_games')
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    target_points = models.IntegerField(default=7)
    status = models.CharField(max_length=20, default='waiting')
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Room {self.code} ({self.status})"


class GameState(models.Model):
    room = models.OneToOneField(GameRoom, on_delete=models.CASCADE)
    state_data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"GameState for {self.room.code}"


class Match(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    duration_seconds = models.IntegerField(null=True, blank=True)
    white_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='match_wins_white')
    black_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='match_wins_black')
    match_type = models.CharField(max_length=10, default='online')
    target_points = models.IntegerField(default=7)
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    winner = models.CharField(max_length=5, null=True, blank=True)
    games = models.JSONField(default=list)

    def __str__(self):
        return f"Match {self.id} ({self.white_score}-{self.black_score})"
