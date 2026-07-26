import json
import uuid
import traceback
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from rest_framework_simplejwt.tokens import AccessToken
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

        # Validate room and user assignment BEFORE accepting
        try:
            room = await get_room(self.room_id)
            if not room:
                await self.close(code=4004)
                return

            if room.white_player and room.white_player.id == self.user_id:
                self.player_color = 'white'
            elif room.black_player and room.black_player.id == self.user_id:
                self.player_color = 'black'
            else:
                await self.close(code=4003)
                return

            self.room_group_name = f'game_{self.room_id}'
            game_state = await get_game_state(room)
            state_data = game_state.state_data or {}
            username = await get_username(self.user_id)
            print(f"[WS] {self.player_color} ({username}) connected, state keys={list(state_data.keys())}, phase={state_data.get('phase')}, turn={state_data.get('turn')}")
            if not state_data:
                print(f"[WS] WARNING: empty state_data for room {self.room_id}")
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

        await self.send(json.dumps({
            'type': 'state_update',
            'payload': state_data,
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

        await self._broadcast_room_status()

    async def disconnect(self, close_code):
        print(f"[WS] disconnect {getattr(self, 'player_color', '?')} code={close_code}")
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

            if message_type == 'state_update':
                await self._handle_state_update(payload)
            else:
                await self._send_error(f'Unknown message type: {message_type}')
        except Exception as e:
            traceback.print_exc()
            await self.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }))

    async def _handle_state_update(self, payload):
        """Save incoming state and broadcast to the other player."""
        room = await get_room(self.room_id)
        if not room:
            return await self._send_error('Room not found')

        print(f"[WS] {self.player_color} sent state_update: phase={payload.get('phase')}, turn={payload.get('turn')}, dice={payload.get('dice')}, openingRoll={payload.get('openingRoll')}")

        gs = await get_game_state(room)
        gs.state_data = payload
        await save_game_state(gs)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': payload,
                'playerColor': self.player_color,
            }
        )

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
