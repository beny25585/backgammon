import json
import uuid
import logging
import traceback
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.db import models
from rest_framework_simplejwt.tokens import AccessToken
from .models import GameRoom, GameState, Match, RoomPlayer, Player, GameEvent
from .helpers import extract_transcript

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_room(room_id):
    try:
        return GameRoom.objects.get(id=uuid.UUID(room_id))
    except (GameRoom.DoesNotExist, ValueError):
        return None


@database_sync_to_async
def get_username(user_id):
    try:
        return User.objects.get(id=user_id).username
    except User.DoesNotExist:
        return None


@database_sync_to_async
def get_room_player_color(room_id, user_id):
    rp = RoomPlayer.objects.filter(room_id=room_id, player__user_id=user_id).first()
    return rp.color if rp else None


@database_sync_to_async
def get_room_player_usernames(room_id):
    """Return usernames for the room's players keyed by color."""
    names = {"white": None, "black": None}
    rps = RoomPlayer.objects.filter(room_id=room_id).select_related('player__user')
    for rp in rps:
        names[rp.color] = rp.player.user.username if rp.player and rp.player.user else None
    return names


@database_sync_to_async
def room_has_both_players(room):
    return room.players.count() >= 2


@database_sync_to_async
def create_match_for_room(room, **kwargs):
    white_rp = room.players.filter(color='white').first()
    black_rp = room.players.filter(color='black').first()
    return Match.objects.create(
        room=room,
        white_player=white_rp.player if white_rp else None,
        black_player=black_rp.player if black_rp else None,
        **kwargs,
    )


ACTION_TO_EVENT_TYPE = {
    'roll': 'roll',
    'move': 'move',
    'undo': 'undo',
    'end_turn': 'end_turn',
    'double': 'double',
    'double_response': 'double_response',
    'resign': 'resign',
}


@database_sync_to_async
def record_event_and_advance(room, player_color, event_type, payload):
    """Atomically bump last_sequence and store a GameEvent. Returns the new sequence."""
    GameRoom.objects.filter(id=room.id).update(last_sequence=models.F('last_sequence') + 1)
    room.refresh_from_db()
    sequence = room.last_sequence
    rp = room.players.filter(color=player_color).first()
    GameEvent.objects.create(
        room=room,
        player=rp if rp else None,
        sequence=sequence,
        event_type=event_type,
        payload=payload,
    )
    return sequence


@database_sync_to_async
def get_game_state(room):
    state, _ = GameState.objects.get_or_create(room=room)
    return state


@database_sync_to_async
def save_game_state(game_state):
    game_state.save()


# Track connected users per room: {room_group_name: {user_id: channel_name}}
_connected_users: dict = {}


class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Validate JWT from query string
        query_string = self.scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]

        if not token:
            logger.warning(f"WS connect rejected (4001): missing token, room={self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')}")
            await self.close(code=4001)
            return

        try:
            valid_token = AccessToken(token)
            self.user_id = valid_token['user_id']
        except Exception as e:
            logger.warning(f"WS connect rejected (4001): invalid token: {e}")
            await self.close(code=4001)
            return

        self.room_id = self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')

        # Validate room and user assignment BEFORE accepting
        try:
            room = await get_room(self.room_id)
            if not room:
                logger.warning(f"WS connect rejected (4004): room not found room={self.room_id}")
                await self.close(code=4004)
                return

            self.player_color = await get_room_player_color(self.room_id, self.user_id)
            if not self.player_color:
                logger.warning(f"WS connect rejected (4003): user {self.user_id} not assigned to room {self.room_id}")
                await self.close(code=4003)
                return

            self.room_group_name = f'game_{self.room_id}'
            game_state = await get_game_state(room)
            state_data = game_state.state_data or {}
            username = await get_username(self.user_id)
            logger.info(f"WebSocket connected: {self.player_color} ({username}) room={self.room_id} phase={state_data.get('phase')}")
            if not state_data:
                logger.warning(f"Empty state_data for room {self.room_id}")
        except Exception as e:
            traceback.print_exc()
            await self.close()
            return

        # All validation passed, accept connection
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        # Track connected user
        if self.room_group_name not in _connected_users:
            _connected_users[self.room_group_name] = {}
        _connected_users[self.room_group_name][self.user_id] = self.channel_name

        username = await get_username(self.user_id)

        players = await get_room_player_usernames(self.room_id)

        await self.send(json.dumps({
            'type': 'state_update',
            'payload': state_data,
            'playerColor': self.player_color,
            'initial': True,
            'players': players,
        }))

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'player_joined',
                'playerColor': self.player_color,
                'username': username,
            }
        )

        await self._broadcast_room_status()

        # Covers the case where the second player joined through the REST API
        # before the creator's WebSocket finished connecting.
        if room.status == 'playing' and await room_has_both_players(room):
            await self.send(json.dumps({'type': 'room_started', 'payload': {}}))

    async def disconnect(self, close_code):
        logger.info(f"WS disconnect: {getattr(self, 'player_color', '?')} room={getattr(self, 'room_id', '?')} code={close_code}")
        if not hasattr(self, 'room_group_name'):
            return

        if hasattr(self, 'player_color') and self.player_color:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_disconnected',
                    'playerColor': self.player_color,
                }
            )

        if hasattr(self, 'user_id') and self.room_group_name in _connected_users:
            _connected_users[self.room_group_name].pop(self.user_id, None)
            if not _connected_users[self.room_group_name]:
                del _connected_users[self.room_group_name]
            else:
                await self._broadcast_room_status()

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            payload = data.get('payload', {})

            logger.info(f"WS receive: type={message_type} player={self.player_color} room={self.room_id}")

            if message_type == 'state_update':
                await self._handle_state_update(payload)
            elif message_type == 'give_up':
                await self._handle_give_up()
            else:
                logger.warning(f"WS unknown message type: {message_type} player={self.player_color}")
                await self._send_error(f'Unknown message type: {message_type}')
        except Exception as e:
            logger.error(f"WS receive error: {e}", exc_info=True)
            traceback.print_exc()
            await self.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }))

    async def _handle_state_update(self, payload):
        """Save incoming state and broadcast to the other player.
        Payload format: {'state': GameState, 'action': str}"""
        room = await get_room(self.room_id)
        if not room:
            logger.warning(f"WS state_update for missing room: {self.room_id}")
            return await self._send_error('Room not found')

        action = payload.get('action')
        state = payload.get('state') if isinstance(payload.get('state'), dict) else payload
        event_type = ACTION_TO_EVENT_TYPE.get(action)

        # Client sends the version it last applied. If it lags the room's current
        # sequence, it's a stale/duplicate update — drop it.
        sent_version = state.get('version')
        if isinstance(sent_version, int) and sent_version > 0 and sent_version < room.last_sequence:
            logger.info(f"WS stale state_update dropped: room={self.room_id} sent_version={sent_version} last_sequence={room.last_sequence}")
            return

        logger.info(f"WS state_update: {self.player_color} room={self.room_id} action={action} phase={state.get('phase')} turn={state.get('turn')}")

        if event_type:
            sequence = await record_event_and_advance(room, self.player_color, event_type, state)
            state['version'] = sequence

        gs = await get_game_state(room)
        gs.state_data = state
        await save_game_state(gs)

        # Auto-save match if game is over and target reached
        if state.get('phase') == 'game_over' and state.get('winner'):
            winner = state.get('winner')
            if winner:
                white_score = room.white_score
                black_score = room.black_score
                target = room.target_points
                white_score_after = white_score + (1 if winner == 'white' else 0)
                black_score_after = black_score + (1 if winner == 'black' else 0)
                if white_score_after >= target or black_score_after >= target:
                    transcript = extract_transcript(state)
                    games_data = [{
                        'game_number': 1,
                        'winner': winner,
                        'win_type': state.get('winType', 'single'),
                        'points_awarded': state.get('cube', 1),
                        'transcript': transcript,
                    }] if transcript else []
                    match = await create_match_for_room(
                        room,
                        match_type='online',
                        target_points=target,
                        white_score=white_score_after,
                        black_score=black_score_after,
                        winner=winner,
                        games=games_data,
                    )
                    logger.info(f"WS match saved: id={match.id} room={self.room_id} winner={winner} score={white_score_after}-{black_score_after}")

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': state,
                'playerColor': self.player_color,
            }
        )

    async def _handle_give_up(self):
        """Handle player giving up voluntarily."""
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            logger.warning(f"WS give_up on non-active game: room={self.room_id} status={getattr(room, 'status', '?')}")
            return await self._send_error('No active game')

        winner = 'black' if self.player_color == 'white' else 'white'
        logger.info(f"WS give_up: {self.player_color} forfeits, winner={winner} room={self.room_id}")

        # Save match record
        game_state = await get_game_state(room)
        transcript = extract_transcript(game_state.state_data)
        games_data = [{
            'game_number': 1,
            'winner': winner,
            'win_type': 'single',
            'points_awarded': 1,
            'transcript': transcript,
        }] if transcript else []

        await create_match_for_room(
            room,
            match_type='online',
            target_points=room.target_points,
            white_score=room.white_score,
            black_score=room.black_score,
            winner=winner,
            games=games_data,
        )

        room.status = 'completed'
        await database_sync_to_async(room.save)()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_forfeited',
                'winner': winner,
                'loser': self.player_color,
            }
        )

    async def game_forfeited(self, event):
        await self.send(json.dumps({
            'type': 'game_forfeited',
            'payload': {
                'winner': event.get('winner'),
                'loser': event.get('loser'),
            }
        }))

    async def _send_error(self, message):
        await self.send(json.dumps({
            'type': 'error',
            'message': message
        }))

    async def _broadcast_room_status(self):
        """Broadcast the number of connected users to the room."""
        count = len(_connected_users.get(self.room_group_name, {}))
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'room_status',
                'connected': count,
            }
        )

    async def game_message(self, event):
        await self.send(json.dumps({
            'type': event['event_type'],
            'payload': event['payload'],
            'playerColor': event['playerColor']
        }))

    async def player_joined(self, event):
        await self.send(json.dumps({
            'type': 'player_joined',
            'payload': {
                'playerColor': event.get('playerColor'),
                'username': event.get('username'),
            }
        }))

    async def player_disconnected(self, event):
        await self.send(json.dumps({
            'type': 'player_disconnected',
            'payload': {
                'playerColor': event.get('playerColor'),
            }
        }))

    async def room_status(self, event):
        await self.send(json.dumps({
            'type': 'room_status',
            'payload': {
                'connected': event.get('connected'),
            }
        }))

    async def room_started(self, event):
        await self.send(json.dumps({'type': 'room_started', 'payload': {}}))
