import json
import uuid
import traceback
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from rest_framework_simplejwt.tokens import AccessToken
from .engine import BackgammonEngine
from .models import GameRoom, GameState


@database_sync_to_async
def get_room(room_id):
    try:
        return GameRoom.objects.select_related('white_player', 'black_player').get(id=uuid.UUID(room_id))
    except (GameRoom.DoesNotExist, ValueError):
        return None


@database_sync_to_async
def get_username(user_id):
    try:
        return User.objects.get(id=user_id).username
    except User.DoesNotExist:
        return None


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
            await self.close(code=4001)
            return

        try:
            valid_token = AccessToken(token)
            self.user_id = valid_token['user_id']
        except Exception:
            await self.close(code=4001)
            return

        self.room_id = self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')
        self.room_group_name = f'game_{self.room_id}'
        self.player_color = None
        self.engine = None

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

        try:
            room = await get_room(self.room_id)
            if not room:
                await self.send(json.dumps({'type': 'error', 'message': 'Room not found'}))
                await self.close()
                return

            game_state = await get_game_state(room)

            if not game_state.state_data:
                game_state.state_data = BackgammonEngine.get_initial_state()
                await save_game_state(game_state)

            self.engine = BackgammonEngine(game_state.state_data)

            # Determine color from room's user FK assignments
            if room.white_player and room.white_player.id == self.user_id:
                self.player_color = 'white'
            elif room.black_player and room.black_player.id == self.user_id:
                self.player_color = 'black'
            else:
                await self.send(json.dumps({'type': 'error', 'message': 'Not assigned to this room'}))
                await self.close(code=4003)
                return

            # Track connected user
            if self.room_group_name not in _connected_users:
                _connected_users[self.room_group_name] = {}
            _connected_users[self.room_group_name][self.user_id] = self.channel_name

            username = await get_username(self.user_id)

            await self.send(json.dumps({
                'type': 'state_update',
                'payload': self.engine.state,
                'playerColor': self.player_color
            }))

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_joined',
                    'playerColor': self.player_color,
                    'username': username,
                }
            )
        except Exception as e:
            traceback.print_exc()
            try:
                await self.send(json.dumps({
                    'type': 'error',
                    'message': str(e)
                }))
            except Exception:
                pass
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'player_color') and self.player_color:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_disconnected',
                    'playerColor': self.player_color,
                }
            )

        # Remove from connected users tracking
        if hasattr(self, 'room_group_name') and hasattr(self, 'user_id') and self.room_group_name in _connected_users:
            _connected_users[self.room_group_name].pop(self.user_id, None)
            if not _connected_users[self.room_group_name]:
                del _connected_users[self.room_group_name]

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            payload = data.get('payload', {})

            handlers = {
                'roll_dice': self.handle_roll_dice,
                'move': lambda: self.handle_move(payload),
                'offer_double': self.handle_offer_double,
                'respond_double': lambda: self.handle_respond_double(payload),
                'end_turn': self.handle_end_turn,
                'undo_move': self.handle_undo_move,
            }

            handler = handlers.get(message_type)
            if handler:
                await handler()
        except Exception as e:
            traceback.print_exc()
            await self.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }))

    async def handle_roll_dice(self):
        if self.engine.state['phase'] == 'opening_roll':
            result = self.engine.apply_opening_roll(self.player_color)
            if not result.get('success', False):
                return await self._send_error(result.get('message', 'Cannot roll'))
            payload = {
                'dice': result['dice'],
                'playerColor': self.player_color,
            }
            if 'winner' in result:
                payload['winner'] = result['winner']
            await self._save_and_broadcast('opening_roll_result', payload)
            if self.engine.state['phase'] != 'opening_roll':
                await self._save_and_broadcast('state_update', self.engine.state)
            return
        turn = self.engine.state.get('turn')
        if turn != self.player_color:
            return await self._send_error('Not your turn')
        result = self.engine.roll_dice()
        await self._save_and_broadcast('dice_rolled', result)

    async def handle_move(self, payload):
        result = self.engine.make_move(
            payload.get('from'), payload.get('to'), self.player_color
        )
        if not result.get('success', False):
            return await self._send_error(result.get('message', 'Invalid move'))
        await self._save_and_broadcast('move_made', self.engine.state)

    async def handle_offer_double(self):
        result = self.engine.offer_double(self.player_color)
        if not result.get('success', False):
            return await self._send_error(result.get('message', 'Cannot double'))
        await self._save_and_broadcast('double_offered', self.engine.state)

    async def handle_respond_double(self, payload):
        result = self.engine.respond_to_double(
            payload.get('accept', False), self.player_color
        )
        if not result.get('success', False):
            return await self._send_error(result.get('message', 'Invalid double response'))
        await self._save_and_broadcast('double_response', self.engine.state)

    async def handle_end_turn(self):
        if self.engine.state.get('turn') != self.player_color:
            return await self._send_error('Not your turn')
        self.engine.end_turn()
        await self._save_and_broadcast('turn_ended', self.engine.state)

    async def handle_undo_move(self):
        if self.engine.state.get('turn') != self.player_color:
            return await self._send_error('Not your turn')
        if self.engine.state.get('phase') != 'moving':
            return await self._send_error('Can only undo during your turn')
        result = self.engine.undo_move()
        if not result.get('success', False):
            return await self._send_error(result.get('message', 'Cannot undo'))
        await self._save_and_broadcast('state_update', self.engine.state)

    async def _save_and_broadcast(self, event_type, payload):
        room = await get_room(self.room_id)
        if not room:
            return
        gs = await get_game_state(room)
        gs.state_data = self.engine.state
        await save_game_state(gs)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': event_type,
                'payload': payload,
                'playerColor': self.player_color
            }
        )

    async def _send_error(self, message):
        await self.send(json.dumps({
            'type': 'error',
            'message': message
        }))

    async def game_message(self, event):
        await self.send(json.dumps({
            'type': event['event_type'],
            'payload': event['payload'],
            'playerColor': event['playerColor']
        }))

    async def player_joined(self, event):
        await self.send(json.dumps({
            'type': 'player_joined',
            'playerColor': event.get('playerColor'),
            'username': event.get('username'),
        }))

    async def player_disconnected(self, event):
        await self.send(json.dumps({
            'type': 'player_disconnected',
            'playerColor': event.get('playerColor'),
        }))
