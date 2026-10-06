"""Commit a game action and its history before acknowledging it to players."""
from django.db import transaction
from django.utils import timezone

from .models import GameEvent, GameRoom, GameState, RoomPlayer


def event_game_id(payload):
    value = payload.get('gameId') if isinstance(payload, dict) else None
    return str(value) if value else 'initial'


def persist_game_action(room_id, state, player_color, event_type):
    """One room lock, one commit; no queue or background event write per action.

    State versions also cover non-game updates. History ordinals advance only
    here, together with the corresponding event. Legacy rooms remain unverified.
    """
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().get(pk=room_id)
        if room.status in ('completed', 'cancelled'):
            raise ValueError('Cannot change a closed game room')
        room.last_sequence += 1
        if room.history_sequence is not None:
            room.history_sequence += 1
        stored = {**state, 'version': room.last_sequence}
        room.save(update_fields=['last_sequence', 'history_sequence'])
        updated = GameState.objects.filter(room_id=room_id).update(
            state_data=stored, updated_at=timezone.now(),
        )
        if not updated:
            raise GameState.DoesNotExist('Game action has no authoritative state')
        player_id = None
        if player_color:
            player_id = RoomPlayer.objects.filter(room_id=room_id, color=player_color).values_list(
                'pk', flat=True).first()
        GameEvent.objects.create(
            room_id=room_id, player_id=player_id,
            game_id=event_game_id(stored), sequence=room.last_sequence,
            history_sequence=room.history_sequence, event_type=event_type,
            payload={**stored, 'actorColor': player_color},
        )
    # Do not expose a version to callers if the transaction rolled back.
    state['version'] = room.last_sequence
    return room.last_sequence
