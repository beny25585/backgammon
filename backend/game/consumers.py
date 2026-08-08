import asyncio
import json
import uuid
import logging
import traceback
import time as time_module
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.db import models
from rest_framework_simplejwt.tokens import AccessToken
from .models import GameRoom, GameState, RoomPlayer, Player, GameEvent
from .clock import active_player, compute_clock, deadline_for
from .game_service import finalize_room, game_ended_payload, record_game_end
from .engine import BackgammonEngine
from .dice import DiceServiceError, fetch_opening_dice, fetch_turn_dice

logger = logging.getLogger(__name__)


def get_user_id_from_token(token):
    if not token:
        return None
    try:
        return AccessToken(token)["user_id"]
    except Exception:
        return None


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


def room_has_both_players(room_group_name):
    """True once both players' WebSockets are connected to the room."""
    return len(_connected_users.get(room_group_name, {})) >= 2


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
    # How long the opening result stays on screen before the winner must roll.
    OPENING_RESULT_DELAY = 3.0

    async def connect(self):
        # Validate JWT from query string
        query_string = self.scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]

        if not token:
            logger.warning(
                "WS connect rejected (4001): missing token",
                extra={"room_id": self.scope.get("url_route", {}).get("kwargs", {}).get("room_id")},
            )
            await self.close(code=4001)
            return

        self.user_id = get_user_id_from_token(token)
        if not self.user_id:
            logger.warning("WS connect rejected (4001): invalid token")
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
            self._timeout_task = None
            game_state = await get_game_state(room)
            state_data = game_state.state_data or {}

            # Ensure an active game always sends authoritative clock state on connect.
            if room.status == 'playing':
                now_ms = int(time_module.time() * 1000)
                clock, turn_started_at, _, _, _ = compute_clock(
                    state_data,
                    state_data,
                    now_ms,
                    room.time_control,
                )
                if clock is not None:
                    normalized_state = dict(state_data)
                    normalized_state.setdefault('clock', clock)
                    normalized_state.setdefault('turnStartedAt', turn_started_at)
                    if (
                        normalized_state.get('clock') != state_data.get('clock')
                        or normalized_state.get('turnStartedAt') != state_data.get('turnStartedAt')
                    ):
                        normalized_state['clock'] = clock
                        normalized_state['turnStartedAt'] = turn_started_at
                        state_data = normalized_state
                        game_state.state_data = state_data
                        await save_game_state(game_state)

            username = await get_username(self.user_id)
            logger.info(f"WebSocket connected: {self.player_color} ({username}) room={self.room_id} phase={state_data.get('phase')}")
            if not state_data:
                logger.warning(f"Empty state_data for room {self.room_id}")
        except Exception as exc:
            logger.exception("WS connect failed", extra={"room_id": self.room_id})
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
            'timeControl': room.time_control,
        }))

        # Mid-game reconnect: resume the active player's deadline.
        if room.status == 'playing':
            active = active_player(state_data)
            deadline = deadline_for(state_data, room.time_control)
            if deadline is not None and active and state_data.get('phase') != 'game_over':
                await self._schedule_timeout(deadline, active)

        # Returning player lands in a finished game.
        if (
            room.status == 'playing'
            and state_data.get('phase') == 'game_over'
            and state_data.get('winner')
        ):
            match_active = (room.state or {}).get('match', {}).get('active')
            if match_active or state_data.get('matchScored'):
                # Mid-match: the room stays open for the next game; re-broadcast
                # the result so the UI can offer "Next Game".
                await self._replay_game_end(state_data, room)
            else:
                # Legacy stale room: close it so it doesn't stay a dead room.
                await self._finalize_and_broadcast(
                    state_data, state_data['winner'], state_data.get('winType', 'single'), 'state_update',
                    force_close=True,
                )

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
        if room.status == 'playing' and room_has_both_players(self.room_group_name):
            await self.send(json.dumps({'type': 'room_started', 'payload': {}}))

        # The opening roll waits for a player to tap (RollPrompt sends
        # {action:'roll'}, which resolves it via _handle_roll_intent). We never
        # auto-resolve just because both sockets are connected — the dice must
        # not roll before the player taps. A returning player in opening_result
        # only re-arms the short countdown (no re-roll).
        if state_data.get('phase') == 'opening_result':
            await self._arm_opening_result_watch()

    async def disconnect(self, close_code):
        logger.info(f"WS disconnect: {getattr(self, 'player_color', '?')} room={getattr(self, 'room_id', '?')} code={close_code}")
        if getattr(self, '_timeout_task', None):
            self._timeout_task.cancel()
        if getattr(self, '_opening_watch_task', None):
            self._opening_watch_task.cancel()
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
                await self._handle_intent(data)
            elif message_type == 'give_up':
                await self._handle_give_up()
            elif message_type == 'game_ended':
                await self._handle_game_ended(payload)
            else:
                logger.warning(f"WS unknown message type: {message_type} player={self.player_color}")
                await self._send_error(f'Unknown message type: {message_type}')
        except Exception as exc:
            logger.exception("WS receive error")
            await self.send(json.dumps({
                'type': 'error',
                'message': str(exc)
            }))

    async def _handle_intent(self, data):
        """Server-authoritative dispatcher. Accepts action intents only.

        Payload format (frontend Step 5): {'action': 'roll'|'move'|'end_turn'|
        'undo'|'double'|'double_response', 'from': int, 'to': int|'off',
        'accept': bool}. The client never sends game state.
        """
        room = await get_room(self.room_id)
        if not room:
            logger.warning(f"WS intent for missing room: {self.room_id}")
            return await self._send_error('Room not found')

        payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}
        intent = dict(payload)
        intent.update({k: v for k, v in data.items() if k not in ('type', 'payload')})

        # Legacy clients that still ship the full state are rejected outright.
        if isinstance(intent.get('state'), dict):
            return await self._send_error(
                'Full state updates are no longer accepted; send intents only'
            )

        action = intent.get('action')
        gs = await get_game_state(room)
        state = dict(gs.state_data or {})
        engine = BackgammonEngine(state)

        logger.info(f"WS intent: {self.player_color} room={self.room_id} action={action} phase={state.get('phase')} turn={state.get('turn')}")

        if action == 'roll':
            result = await self._handle_roll_intent(engine)
        elif action == 'move':
            result = engine.make_move(
                intent.get('from'), intent.get('to'), self.player_color
            )
        elif action == 'end_turn':
            if engine.state.get('turn') != self.player_color:
                result = {'success': False, 'message': 'Not your turn'}
            else:
                result = engine.end_turn()
        elif action == 'undo':
            if (
                engine.state.get('phase') != 'moving'
                or engine.state.get('turn') != self.player_color
            ):
                result = {'success': False, 'message': 'Cannot undo now'}
            else:
                result = engine.undo_move()
        elif action == 'double':
            result = engine.offer_double(self.player_color)
        elif action == 'double_response':
            result = engine.respond_to_double(
                bool(intent.get('accept')), self.player_color
            )
        elif action == 'next_game':
            result = await self._handle_next_game(engine)
        else:
            return await self._send_error(f'Unknown action: {action}')

        if not result.get('success'):
            return await self._send_error(result.get('message', 'Action rejected'))

        state = engine.state
        sequence = await record_event_and_advance(room, self.player_color, action, state)
        state['version'] = sequence

        # Server-owned clock: recompute from our wall clock, never trust the client.
        now_ms = int(time_module.time() * 1000)
        stored = gs.state_data or {}
        clock, turn_started_at, new_active, timed_out, _deadline = compute_clock(
            stored, state, now_ms, room.time_control
        )
        if clock is not None:
            state['clock'] = clock
            state['turnStartedAt'] = turn_started_at

        if timed_out and new_active:
            gs.state_data = state
            await save_game_state(gs)
            winner = 'black' if new_active == 'white' else 'white'
            return await self._forfeit_on_time(winner, new_active)

        gs.state_data = state
        await save_game_state(gs)

        if clock is not None and new_active:
            await self._reschedule_timeout_from_state()

        # Opening result is only shown briefly; then the winner must roll.
        if state.get('phase') == 'opening_result':
            await self._arm_opening_result_watch()

        # Centralized game-end: any game_over state the engine reports finalizes
        # the room (idempotent) and broadcasts game_ended to everyone.
        if state.get('phase') == 'game_over' and state.get('winner'):
            return await self._finalize_and_broadcast(
                state, state['winner'], state.get('winType', 'single'), action
            )

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': state,
                'playerColor': self.player_color,
            }
        )

    async def _handle_roll_intent(self, engine):
        """Roll during the opening or a normal turn.

        Every die comes from the trusted Elixir dice service. The opening pair
        is fetched once (opening URL, never doubles) and stored hidden in
        `state['openingDice']`; each player taps to reveal their own die. Normal
        turn rolls use the normal URL.
        """
        state = engine.state
        if state.get('phase') == 'opening_roll':
            if state.get('turn') != self.player_color:
                return {'success': False, 'message': 'Not your turn to roll'}
            seed = state.get('openingDice')
            if not seed:
                try:
                    white, black = await fetch_opening_dice()
                except DiceServiceError as exc:
                    logger.error("Dice service failed for opening roll: %s", exc)
                    return {'success': False, 'message': f'Dice service error: {exc}'}
                seed = [white, black]
                engine.state['openingDice'] = seed
            die = seed[0] if self.player_color == 'white' else seed[1]
            return engine.roll_opening_die(self.player_color, die=die)
        if state.get('phase') == 'rolling' and state.get('turn') == self.player_color:
            try:
                a, b = await fetch_turn_dice()
            except DiceServiceError as exc:
                logger.error("Dice service failed for turn roll: %s", exc)
                return {'success': False, 'message': f'Dice service error: {exc}'}
            return engine.roll_dice(dice=(a, b))
        return {'success': False, 'message': 'Cannot roll now'}

    async def _arm_opening_result_watch(self):
        """(Re)arm the countdown from opening_result to rolling."""
        if getattr(self, '_opening_watch_task', None):
            self._opening_watch_task.cancel()
        self._opening_watch_task = asyncio.create_task(self._opening_result_watch())

    async def _opening_result_watch(self):
        await asyncio.sleep(GameConsumer.OPENING_RESULT_DELAY)
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            return
        gs = await get_game_state(room)
        state = gs.state_data or {}
        if state.get('phase') != 'opening_result':
            return

        state['phase'] = 'rolling'
        state['dice'] = []
        state['remaining'] = []
        state['lastMove'] = None
        state['moveHistory'] = None
        state.pop('openingDice', None)
        sequence = await record_event_and_advance(room, None, 'opening_result_done', state)
        state['version'] = sequence

        # The winner is now on the clock.
        now_ms = int(time_module.time() * 1000)
        stored = state
        clock, turn_started_at, new_active, _timed_out, _deadline = compute_clock(
            stored, state, now_ms, room.time_control
        )
        if clock is not None:
            state['clock'] = clock
            state['turnStartedAt'] = turn_started_at

        gs.state_data = state
        await save_game_state(gs)
        await self._reschedule_timeout_from_state()
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': state,
                'playerColor': None,
            }
        )

    async def _handle_give_up(self):
        """Handle player giving up voluntarily, routed through finalize_room."""
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            logger.warning(f"WS give_up on non-active game: room={self.room_id} status={getattr(room, 'status', '?')}")
            return await self._send_error('No active game')

        winner = 'black' if self.player_color == 'white' else 'white'
        logger.info(f"WS give_up: {self.player_color} forfeits, winner={winner} room={self.room_id}")

        game_state = await get_game_state(room)
        state = dict(game_state.state_data or {})
        state['phase'] = 'game_over'
        state['winner'] = winner
        state['winType'] = 'single'
        game_state.state_data = state
        await save_game_state(game_state)

        await self._finalize_and_broadcast(state, winner, 'single', 'give_up')

    async def _handle_game_ended(self, payload):
        """Receive a client game_ended signal and finalize the room."""
        room = await get_room(self.room_id)
        if not room:
            logger.warning(f"WS game_ended for missing room: {self.room_id}")
            return await self._send_error('Room not found')

        game_state = await get_game_state(room)
        state = dict(game_state.state_data or {})
        winner = payload.get('winner') or state.get('winner')
        win_type = payload.get('winType', 'single') or state.get('winType', 'single')
        reason = payload.get('reason', 'game_ended')
        if payload.get('cube') is not None:
            state['cube'] = payload['cube']

        if winner:
            state['phase'] = 'game_over'
            state['winner'] = winner
            state['winType'] = win_type
            game_state.state_data = state
            await save_game_state(game_state)
            await self._finalize_and_broadcast(state, winner, win_type, reason)
        else:
            logger.warning(f"WS game_ended without winner: room={self.room_id} payload={payload}")

    async def _handle_next_game(self, engine):
        """Start the next game of a match after a finished game.

        The room stays 'playing' until `target_points` is reached, so after a
        non-final game either player can request the next one. The board resets
        to a fresh opening roll (the opening dice are re-fetched on the first
        tap; no cached pair is carried over).
        """
        state = engine.state
        if state.get('phase') != 'game_over' or not state.get('winner'):
            return {'success': False, 'message': 'Cannot start next game now'}
        if not state.get('matchScored'):
            return {'success': False, 'message': 'Game result not settled'}
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            return {'success': False, 'message': 'No active game'}
        engine.state = BackgammonEngine.get_initial_state()
        engine.state['message'] = 'New game started'
        return {'success': True}

    async def _finalize_and_broadcast(self, state, winner, win_type, reason, force_close=False):
        """Score the finished game and broadcast game_ended to the room.

        Normal endings route through `record_game_end`, which keeps the room
        open across games until a player reaches `target_points`. `force_close`
        is used for legacy stale rooms that must be closed immediately.
        """
        room = await get_room(self.room_id)
        if not room:
            return
        gs = await get_game_state(room)
        stored = gs.state_data or {}
        if stored.get('matchScored'):
            return
        if force_close:
            match_obj = await database_sync_to_async(finalize_room)(
                room, state, winner, win_type, reason
            )
            if match_obj is None:
                return
            match_over = True
        else:
            result = await database_sync_to_async(record_game_end)(
                room, state, winner, win_type, reason
            )
            if result is None:
                return
            match_over = result['match_over']
        stored = dict(stored)
        stored['matchScored'] = True
        gs.state_data = stored
        await save_game_state(gs)
        await database_sync_to_async(room.refresh_from_db)()
        payload = game_ended_payload(state, winner, win_type, reason, room)
        payload['matchOver'] = match_over
        payload['nextGame'] = not match_over
        logger.info(f"WS game_ended: room={self.room_id} winner={winner} win_type={win_type} reason={reason} match_over={match_over}")
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_ended', 'payload': payload},
        )

    async def _replay_game_end(self, state, room):
        """Re-broadcast a mid-match result for a returning player."""
        winner = state.get('winner')
        if not winner:
            return
        payload = game_ended_payload(
            state, winner, state.get('winType', 'single'), 'state_update', room
        )
        payload['matchOver'] = False
        payload['nextGame'] = True
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_ended', 'payload': payload},
        )

    async def game_ended(self, event):
        await self.send(json.dumps({
            'type': 'game_ended',
            'payload': event.get('payload'),
        }))

    async def _schedule_timeout(self, deadline_ms, active_color):
        """(Re)schedule a deadline watch for the active player."""
        if getattr(self, '_timeout_task', None):
            self._timeout_task.cancel()
        if deadline_ms is None or deadline_ms <= 0:
            return
        self._timeout_task = asyncio.create_task(self._timeout_watch(deadline_ms / 1000.0, active_color))

    async def _timeout_watch(self, deadline, active_color):
        delay = deadline - time_module.time()
        if delay > 0:
            await asyncio.sleep(delay)
        room = await get_room(self.room_id)
        if not room:
            return
        gs = await get_game_state(room)
        stored = gs.state_data or {}
        if active_player(stored) != active_color:
            return
        if stored.get('phase') == 'game_over':
            return
        winner = 'black' if active_color == 'white' else 'white'
        await self._forfeit_on_time(winner, active_color)

    async def _reschedule_timeout_from_state(self):
        """Re-arm the deadline from the saved state (e.g. after a disconnect)."""
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            return
        gs = await get_game_state(room)
        stored = gs.state_data or {}
        active = active_player(stored)
        if not active or stored.get('phase') == 'game_over':
            return
        deadline = deadline_for(stored, room.time_control)
        await self._schedule_timeout(deadline, active)

    async def _forfeit_on_time(self, winner, loser):
        """Mark the game over because `loser` ran out of time and broadcast it."""
        room = await get_room(self.room_id)
        if not room:
            return
        gs = await get_game_state(room)
        stored = dict(gs.state_data or {})
        if stored.get('phase') == 'game_over':
            return
        stored['phase'] = 'game_over'
        stored['winner'] = winner
        stored['winType'] = 'single'
        stored['message'] = f'{loser} ran out of time'
        gs.state_data = stored
        await save_game_state(gs)
        logger.info(f"WS timeout forfeit: loser={loser} winner={winner} room={self.room_id}")
        await self._finalize_and_broadcast(stored, winner, 'single', 'time')

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
        await self._reschedule_timeout_from_state()

    async def room_status(self, event):
        await self.send(json.dumps({
            'type': 'room_status',
            'payload': {
                'connected': event.get('connected'),
            }
        }))

    async def room_started(self, event):
        await self.send(json.dumps({'type': 'room_started', 'payload': {}}))
