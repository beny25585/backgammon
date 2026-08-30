from django.contrib import admin
from .models import GameRoom, GameState, Match, Player, RoomPlayer, GameEvent, Task

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


class ReadOnlyModelAdmin(admin.ModelAdmin):
    """Nothing here is editable: these rows are a record of what happened, not a control panel."""

    def get_readonly_fields(self, request, obj = None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj = None):
        return False


@admin.register(Task)
class TaskAdmin(ReadOnlyModelAdmin):
    """
    Dead-letter view for the background queue.

    `run_tasks` gives a task three attempts on a 5/10/15-minute backoff and then marks it `failed`
    and stops. Nothing alerts on that, so this list is the only place a result that never reached
    the tournaments server becomes visible. Filter to `status = failed` for the dead letters; the
    `error` column carries the first line of the traceback that stopped it.
    """

    list_display  = ('id', 'name', 'status', 'attempt_count', 'run_at', 'updated_at', 'error')
    list_filter   = ('status', 'name')
    search_fields = ('id', 'name', 'last_error')

    ordering = ('-updated_at',)

    @admin.display(description = 'attempts')
    def attempt_count(self, task):
        return f'{task.attempts}/{task.max_attempts}'

    @admin.display(description = 'error')
    def error(self, task):
        if not task.last_error:
            return ''
        # The last line of a traceback is the exception; that is the part worth showing in a list.
        last_line = task.last_error.strip().splitlines()[-1]
        return last_line if len(last_line) <= 120 else last_line[:117] + '...'
