from django.contrib import admin
from .models import GameRoom, GameState, Match, Player, RoomPlayer, GameEvent

@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'nickname', 'rating', 'wins', 'losses', 'win_streak')
    search_fields = ('user__username', 'nickname')

@admin.register(GameRoom)
class GameRoomAdmin(admin.ModelAdmin):
    list_display = ('code', 'status', 'white_score', 'black_score', 'target_points', 'last_sequence', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('code',)

@admin.register(RoomPlayer)
class RoomPlayerAdmin(admin.ModelAdmin):
    list_display = ('room', 'player', 'color', 'joined_at')
    search_fields = ('room__code', 'player__nickname', 'player__user__username')

@admin.register(GameState)
class GameStateAdmin(admin.ModelAdmin):
    list_display = ('room', 'updated_at')
    search_fields = ('room__id',)

@admin.register(GameEvent)
class GameEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'room', 'player', 'sequence', 'event_type', 'created_at')
    list_filter = ('event_type',)
    search_fields = ('room__code',)
    ordering = ('room', 'sequence')


class MatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'room', 'white_player', 'black_player', 'white_score', 'black_score', 'winner', 'created_at')
    readonly_fields = ('id', 'created_at')

admin.site.register(Match, MatchAdmin)
