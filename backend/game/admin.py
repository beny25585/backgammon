from django.contrib import admin
from .models import GameRoom, GameState, Match

@admin.register(GameRoom)
class GameRoomAdmin(admin.ModelAdmin):
    list_display = ('code', 'status', 'white_player', 'black_player', 'white_score', 'black_score', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('code',)

@admin.register(GameState)
class GameStateAdmin(admin.ModelAdmin):
    list_display = ('room', 'updated_at')
    search_fields = ('room__id',)


class MatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'white_player', 'black_player', 'white_score', 'black_score', 'winner', 'created_at')
    readonly_fields = ('id', 'created_at')

admin.site.register(Match, MatchAdmin)
