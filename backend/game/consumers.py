import asyncio
import copy
import json
import uuid
import logging
import traceback
import time as time_module
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.db import models, transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from .models import GameRoom, GameState, RoomPlayer, Player, GameEvent
from .clock import active_player, compute_clock, deadline_for
from .game_service import finalize_room, game_ended_payload, record_game_end
from .server_actions import (
    apply_server_game_action,
    event_game_id,
    run_in_background,
)
from .presence import (HEARTBEAT_SECONDS,  check_room_presence, mark_connected,
                       mark_disconnected, mark_heartbeat, needs_admin_adjudication,
                       both_players_connected, connected_colors,
                       STALE_SECONDS)
from .link.live import publish_snapshot
from .link.rematch import RematchServiceError, send_direct_play_rematch_action
from .engine import BackgammonEngine
from .dice import DiceServiceError, fetch_opening_dice, fetch_turn_dice

from .game_service import RoomCancellationError, cancel_waiting_room

from .inactivity import ensure_inactivity_check, refresh_after_action

logger = logging.getLogger(__name__)

SLOW_DISPATCH_MS = 250


def get_user_id_from_token(token):
    if not token:
        return None
    try:
        return AccessToken(token)["user_id"]
    except Exception:
        return None


@database_sync_to_async
def get_room(room_id, *, with_link=False):
    try:
        rooms = GameRoom.objects.select_related('tournament_link') if with_link else GameRoom.objects
        return rooms.get(id=uuid.UUID(str(room_id)))
    except (GameRoom.DoesNotExist, ValueError):
        return None


@database_sync_to_async
def is_linked_room(room_id):
    from .link.models import TournamentLink
    return TournamentLink.objects.filter(room_id=room_id).exists()


@database_sync_to_async
def get_username(user_id):
    player = Player.objects.select_related(
        'user').filter(user_id=user_id).first()
    if player is not None:
        return str(player)

    try:
        return User.objects.get(id=user_id).username
    except User.DoesNotExist:
        return None


@database_sync_to_async
def get_room_player_color(room_id, user_id):
    rp = RoomPlayer.objects.filter(
        room_id=room_id, player__user_id=user_id).first()
    return rp.color if rp else None


@database_sync_to_async
def get_room_player_usernames(room_id):
    """Return display names for the room's players keyed by color."""
    names = {"white": None, "black": None}
    rps = RoomPlayer.objects.filter(
        room_id=room_id).select_related('player__user')
    for rp in rps:
        names[rp.color] = str(rp.player) if rp.player else None
    if GameRoom.objects.filter(pk=room_id, state__ai__isnull=False).exists():
        names["black"] = "Open Sage"
    return names


def room_has_both_players(room_group_name):
    """True once both players' WebSockets are connected to the room."""
    return len(_connected_users.get(room_group_name, {})) >= 2


@database_sync_to_async
def record_event_and_advance(room, player_color, event_type, payload):
    """Atomically bump last_sequence and store a GameEvent. Returns the new sequence."""
    GameRoom.objects.filter(id=room.id).update(
        last_sequence=models.F('last_sequence') + 1)
    room.refresh_from_db()
    sequence = room.last_sequence
    rp = room.players.filter(color=player_color).first()
    GameEvent.objects.create(
        room=room,
        player=rp if rp else None,
        game_id=event_game_id(payload),
        sequence=sequence,
        event_type=event_type,
        payload={**payload, "actorColor": player_color},
    )
    return sequence


@database_sync_to_async
def get_game_state(room):
    state, _ = GameState.objects.get_or_create(room=room)
    return state


@database_sync_to_async
def save_game_state(game_state):
    game_state.save()


# Track connected users per room: {room_group_name: {user_id: {channel_name, ...}}}
_connected_users: dict = {}
# Track connected player colors per room: {room_group_name: {user_id: player_color}}
_connected_user_colors: dict = {}

# Per-room auto-next-game timers: {room_group_name: asyncio.Task}. The countdown
# belongs to the room, not any socket, so it survives disconnects.
_auto_next_tasks: dict = {}
# Epoch ms deadlines keyed by room_group_name, used to report remaining seconds
# to a reconnecting player.
_auto_next_deadlines: dict = {}


class GameConsumer(AsyncWebsocketConsumer):
    NO_MOVES_REVEAL_MS = 350
    # How long the opening result stays on screen before the winner must roll.
    OPENING_RESULT_DELAY = 3.0
    # How long a finished (but not match-ending) game waits before the server
    # auto-starts the next game of the match.
    NEXT_GAME_DELAY = 30.0

    def _socket_entry_event(self, event, *, reason='-', error=None):
        try:
            room_id = str(uuid.UUID(str(getattr(self, 'room_id', ''))))
        except (ValueError, TypeError, AttributeError):
            room_id = 'invalid'
        log = logger.warning if event == 'socket_auth_refused' else logger.info
        log(
            'event=%s connection_id=%s tournament_id=%s fixture_id=%s room_id=%s '
            'user_id=%s color=%s reason=%s error_type=%s',
            event, getattr(self, 'incident_connection_id', '-'),
            getattr(self, 'linked_tournament_id', '-'), getattr(self, 'linked_fixture_id', '-'),
            room_id, getattr(self, 'user_id', '-'), getattr(self, 'player_color', '-') or '-',
            reason, type(error).__name__ if error is not None else '-',
        )

    async def room_expired(self, event):
        await self.send(json.dumps({'type': 'room_expired', 'payload': {'reason': 'entry_timeout'}}))
        await self.close(code=4004)

    async def dispatch(self, message):
        message_type = (
            message.get("type")
            if isinstance(message, dict)
            else type(message).__name__
        )

        raw_received_perf = (
            message.get("_ws_raw_received_perf")
            if isinstance(message, dict)
            else None
        )
        connection_id = None
        if isinstance(message, dict):
            connection_id = message.get("_ws_trace_connection_id")
        if connection_id is None:
            connection_id = self.scope.get("trace_connection_id")

        started = time_module.perf_counter()
        if isinstance(raw_received_perf, (int, float)):
            raw_to_dispatch_ms = int((started - raw_received_perf) * 1000)
        else:
            raw_to_dispatch_ms = None

        try:
            return await super().dispatch(message)
        finally:
            total_ms = int(
                (time_module.perf_counter() - started) * 1000
            )

            if total_ms >= SLOW_DISPATCH_MS:
                logger.warning(
                    "SLOW_CONSUMER_DISPATCH "
                    "connection=%s channel=%s user=%s color=%s "
                    "type=%s total_ms=%s raw_to_dispatch_ms=%s",
                    connection_id,
                    getattr(self, "channel_name", None),
                    getattr(self, "user_id", None),
                    getattr(self, "player_color", None),
                    message_type,
                    total_ms,
                    raw_to_dispatch_ms,
                )

    async def connect(self):
        self.incident_connection_id = uuid.uuid4().hex
        self.room_id = self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')
        # Validate JWT from query string
        query_string = self.scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]

        if not token:
            self._socket_entry_event('socket_auth_refused', reason='missing_token')
            await self.close(code=4001)
            return

        self.user_id = get_user_id_from_token(token)
        if not self.user_id:
            self._socket_entry_event('socket_auth_refused', reason='invalid_token')
            await self.close(code=4001)
            return

        self.room_id = self.scope.get('url_route', {}).get(
            'kwargs', {}).get('room_id')

        # Validate room and user assignment BEFORE accepting
        try:
            room = await get_room(self.room_id, with_link=True)
            if not room:
                self._socket_entry_event('socket_auth_refused', reason='room_not_found')
                await self.close(code=4004)
                return

            link = getattr(room, 'tournament_link', None)
            if link is not None:
                self.linked_tournament_id = link.tournament_id
                self.linked_fixture_id = link.fixture_id

            self.player_color = await get_room_player_color(self.room_id, self.user_id)
            if not self.player_color:
                self._socket_entry_event('socket_auth_refused', reason='user_not_assigned_to_room')
                await self.close(code=4003)
                return

            self.room_group_name = f'game_{self.room_id}'
            self._timeout_task = None
            game_state = await get_game_state(room)
            state_data = game_state.state_data or {}
            timed_out_color = None
            admin_review_pending = await database_sync_to_async(
                needs_admin_adjudication
            )(room)

            # Ensure an active game always sends authoritative clock state on connect.
            if room.status == 'playing' and not admin_review_pending:
                now_ms = int(time_module.time() * 1000)
                clock, turn_started_at, clock_active, timed_out, _ = compute_clock(
                    state_data,
                    state_data,
                    now_ms,
                    room.time_control,
                    room.target_points,
                )
                if clock is not None:
                    normalized_state = dict(state_data)
                    normalized_state.setdefault('clock', clock)
                    normalized_state.setdefault(
                        'turnStartedAt', turn_started_at)
                    if (
                        normalized_state.get(
                            'clock') != state_data.get('clock')
                        or normalized_state.get('turnStartedAt') != state_data.get('turnStartedAt')
                    ):
                        normalized_state['clock'] = clock
                        normalized_state['turnStartedAt'] = turn_started_at
                        state_data = normalized_state
                        game_state.state_data = state_data
                        await save_game_state(game_state)
                if timed_out:
                    timed_out_color = clock_active

            username = await get_username(self.user_id)
            logger.info(
                f"WebSocket connected: {self.player_color} ({username}) room={self.room_id} phase={state_data.get('phase')}")
            if not state_data:
                logger.warning(f"Empty state_data for room {self.room_id}")
        except Exception as exc:
            self._socket_entry_event('socket_auth_refused', reason='connection_setup_failed', error=exc)
            logger.exception("WS connect failed", extra={
                             "room_id": self.room_id})
            await self.close()
            return

        # All validation passed, accept connection
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()
        self._socket_entry_event('socket_joined')

        # Track connected user
        if self.room_group_name not in _connected_users:
            _connected_users[self.room_group_name] = {}
        if self.room_group_name not in _connected_user_colors:
            _connected_user_colors[self.room_group_name] = {}
        _connected_users[self.room_group_name].setdefault(self.user_id, set()).add(
            self.channel_name
        )
        _connected_user_colors[self.room_group_name][self.user_id] = self.player_color
        connected = await database_sync_to_async(mark_connected)(
            room.id, self.channel_name, self.player_color
        )
        if connected is False:
            await self.room_expired({})
            return
        self._presence_heartbeat_task = asyncio.create_task(
            self._presence_heartbeat())

        username = await get_username(self.user_id)

        players = await get_room_player_usernames(self.room_id)

        await self.send(json.dumps({
            'type': 'state_update',
            'payload': state_data,
            'playerColor': self.player_color,
            'initial': True,
            'players': players,
            'timeControl': room.time_control,
            'targetPoints': room.target_points,
            'matchScore': {
                'white': room.white_score,
                'black': room.black_score,
            },
        }))

        if admin_review_pending:
            await self.send(json.dumps({
                'type': 'admin_review_required',
                'payload': {'message': 'Match paused pending organizer decision'},
            }))

        if timed_out_color:
            winner = 'black' if timed_out_color == 'white' else 'white'
            await self._forfeit_on_time(winner, timed_out_color)
            return

        # Mid-game reconnect: resume the active player's deadline.
        if room.status == 'playing' and not admin_review_pending:
            active = active_player(state_data)
            deadline = deadline_for(
                state_data, room.time_control, room.target_points)
            if deadline is not None and active and state_data.get('phase') != 'game_over':
                await self._schedule_timeout(deadline, active)

        # Returning player lands in a finished game.
        if (
            room.status == 'playing'
            and not admin_review_pending
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
                    state_data, state_data['winner'], state_data.get(
                        'winType', 'single'), 'state_update',
                    force_close=True,
                )
        elif (
            room.status in ('completed', 'cancelled')
            and state_data.get('phase') == 'game_over'
            and state_data.get('winner')
        ):
            # The room was already closed (leave, forfeit, or target reached):
            # re-broadcast the recorded result so the UI shows who won and why.
            await self._replay_finalized_game_end(state_data, room)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'player_joined',
                'playerColor': self.player_color,
                'username': username,
            }
        )
        asyncio.create_task(
            database_sync_to_async(
                publish_snapshot,
                thread_sensitive=False,
            )(
                room.id,
                state_data,
            )
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
        logger.info(
            f"WS disconnect: {getattr(self, 'player_color', '?')} room={getattr(self, 'room_id', '?')} code={close_code}")
        if getattr(self, '_timeout_task', None):
            self._timeout_task.cancel()
        if getattr(self, '_opening_watch_task', None):
            self._opening_watch_task.cancel()
        if getattr(self, '_presence_heartbeat_task', None):
            self._presence_heartbeat_task.cancel()
        if not hasattr(self, 'room_group_name'):
            return

        if hasattr(self, 'user_id') and self.room_group_name in _connected_users:
            connected = _connected_users[self.room_group_name]
            user_channels = connected.get(self.user_id, set())
            user_channels.discard(self.channel_name)
            if not user_channels and self.user_id in connected:
                connected.pop(self.user_id, None)
                _connected_user_colors.get(
                    self.room_group_name, {}).pop(self.user_id, None)
                if hasattr(self, 'player_color') and self.player_color:
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'player_disconnected',
                            'playerColor': self.player_color,
                        }
                    )
            if not connected:
                _connected_users.pop(self.room_group_name, None)
                _connected_user_colors.pop(self.room_group_name, None)
            else:
                await self._broadcast_room_status()

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        should_watch = await database_sync_to_async(mark_disconnected)(
            self.room_id, self.channel_name
        )
        if should_watch:
            run_in_background(self._presence_absence_watch())
        # Completed room disconnect: invalidate rematch, do NOT start 40s forfeit
        try:
            room = await get_room(self.room_id)
            if room and room.status == 'completed':
                link = await self._get_rematch_link(room)
                if link is not None and link.tournament_id == 0 and link.fixture_id < 0:
                    try:
                        await database_sync_to_async(send_direct_play_rematch_action,

                                                     thread_sensitive=False,)(
                            link=link, room=room, actor_color=self.player_color, action='disconnect'
                        )
                    except Exception:
                        pass
                    other = 'black' if self.player_color == 'white' else 'white'
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': other, 'payload': {
                            'status': 'unavailable', 'reason': 'opponent_left'}}
                    )
                elif link is None:
                    def _clear_private_rematch():
                        with transaction.atomic():
                            try:
                                r = GameRoom.objects.select_for_update().get(pk=room.id)
                                s = dict(r.state or {})
                                if s.get('rematch'):
                                    s.pop('rematch', None)
                                    r.state = s
                                    r.save(update_fields=['state'])
                            except GameRoom.DoesNotExist:
                                pass
                    await database_sync_to_async(_clear_private_rematch)()
                    other = 'black' if self.player_color == 'white' else 'white'
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': other, 'payload': {
                            'status': 'unavailable', 'reason': 'opponent_left'}}
                    )
        except Exception:
            pass

    async def _presence_heartbeat(self):
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await database_sync_to_async(mark_heartbeat)(self.room_id, self.channel_name)

    async def _presence_absence_watch(self):
        await asyncio.sleep(40)
        await database_sync_to_async(check_room_presence)(self.room_id)

    async def receive(self, text_data):
        receive_started = time_module.perf_counter()

        receive_epoch_ms = int(time_module.time() * 1000)
        receive_room_ms = 0
        receive_admin_ms = 0
        receive_dispatch_ms = 0
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            payload = data.get('payload', {})

            logger.info(
                f"WS receive: type={message_type} player={self.player_color} room={self.room_id}")

            room_lookup_started = time_module.perf_counter()
            room = await get_room(self.room_id)
            receive_room_ms = int(
                (time_module.perf_counter() - room_lookup_started) * 1000
            )
            if room:
                admin_check_started = time_module.perf_counter()

                admin_review_pending = await database_sync_to_async(
                    needs_admin_adjudication
                )(room)
                receive_admin_ms = int(
                    (time_module.perf_counter() - admin_check_started) * 1000
                )
            else:
                admin_review_pending = False
                receive_admin_ms = 0

            # Keep gameplay paused, but allow an explicit match forfeit.
            if room and admin_review_pending and message_type != 'leave':
                await self.send(json.dumps({
                    'type': 'admin_review_required',
                    'payload': {'message': 'Match paused pending organizer decision'},
                }))
                return

            if message_type == 'state_update':
                dispatch_started = time_module.perf_counter()
                await self._handle_intent(data)
                receive_dispatch_ms = int(
                    (time_module.perf_counter() - dispatch_started) * 1000
                )

                receive_total_ms = int(
                    (time_module.perf_counter() - receive_started) * 1000
                )

                if receive_total_ms >= SLOW_DISPATCH_MS:
                    logger.warning(
                        "SLOW_WS_RECEIVE "
                        "room=%s player=%s type=%s "
                        "room_ms=%s admin_ms=%s dispatch_ms=%s total_ms=%s",
                        self.room_id,
                        self.player_color,
                        message_type,
                        receive_room_ms,
                        receive_admin_ms,
                        receive_dispatch_ms,
                        receive_total_ms,
                    )
            elif message_type == 'give_up':
                await self._handle_give_up()
            elif message_type == 'leave':
                await self._handle_leave()
            elif message_type == 'game_ended':
                await self._handle_game_ended(payload)
            elif message_type == 'rematch_request':
                await self._handle_rematch_request()
            elif message_type == 'rematch_accept':
                await self._handle_rematch_accept()
            elif message_type == 'rematch_decline':
                await self._handle_rematch_decline()
            elif message_type == 'rematch_cancel':
                await self._handle_rematch_cancel()
            else:
                logger.warning(
                    f"WS unknown message type: {message_type} player={self.player_color}")
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
        'undo'|'reorder_dice'|'double'|'double_response', 'from': int, 'to': int|'off',
        'accept': bool}. The client never sends game state.
        """

        intent_started = time_module.perf_counter()
        intent_room_started = time_module.perf_counter()

        room = await get_room(self.room_id)

        intent_room_ms = int(
            (time_module.perf_counter() - intent_room_started) * 1000
        )
        if not room:
            logger.warning(f"WS intent for missing room: {self.room_id}")
            return await self._send_error('Room not found')

        payload = data.get('payload') if isinstance(
            data.get('payload'), dict) else {}
        intent = dict(payload)
        intent.update({k: v for k, v in data.items()
                      if k not in ('type', 'payload')})

        # Legacy clients that still ship the full state are rejected outright.
        if isinstance(intent.get('state'), dict):
            return await self._send_error(
                'Full state updates are no longer accepted; send intents only'
            )

        action = intent.get('action')
        game_state_started = time_module.perf_counter()

        gs = await get_game_state(room)

        game_state_ms = int(
            (time_module.perf_counter() - game_state_started) * 1000
        )
        state = dict(gs.state_data or {})
        engine_init_started = time_module.perf_counter()
        engine = BackgammonEngine(state)
        engine_init_ms = int(
            (time_module.perf_counter() - engine_init_started) * 1000
        )

        logger.info(
            f"WS intent: {self.player_color} room={self.room_id} action={action} phase={state.get('phase')} turn={state.get('turn')}")
        engine_action_started = time_module.perf_counter()
        if action == 'roll':
            result = await self._handle_roll_intent(engine)
            logger.info(
                f"[roll] result success={result.get('success')} msg={result.get('message')}")
        elif action == 'move':
            result = engine.make_move(
                intent.get('from'), intent.get('to'), self.player_color,
                die=intent.get('die'),
            )
        elif action == 'reorder_dice':
            result = engine.reorder_dice(self.player_color)
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

        engine_action_ms = int(
            (time_module.perf_counter() - engine_action_started) * 1000
        )

        if not result.get('success'):
            logger.info(
                f"[intent] FAILED action={action} msg={result.get('message')}")
            return await self._send_error(
                result.get('message', 'Action rejected'), action=action
            )

        state = engine.state
        logger.info(
            f"[intent] OK action={action} phase={state.get('phase')} turn={state.get('turn')} dice={state.get('dice')} remaining={state.get('remaining')}")

        async def _on_timeout(winner, loser):
            await self._forfeit_on_time(winner, loser)

        async def _on_reschedule_timeout():
            await self._reschedule_timeout_from_state()

        async def _on_opening_result():
            await self._arm_opening_result_watch()

        async def _on_game_over(state, winner, win_type, reason):
            await self._finalize_and_broadcast(
                state, winner, win_type, reason
            )

        async def _on_state_update(*, state, player_color, action):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'game_message',
                    'event_type': 'state_update',
                    'payload': state,
                    'playerColor': player_color,
                    'action': action,
                }
            )

        async def _on_turn_notice(*, turn_notice, player_color):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'game_message',
                    'event_type': 'turn_notice',
                    'payload': {
                        **turn_notice,
                        'revealAfterMs': self.NO_MOVES_REVEAL_MS,
                    },
                    'playerColor': player_color,
                }
            )
        pre_pipeline_ms = int(
            (time_module.perf_counter() - intent_started) * 1000
        )

        stored = gs.state_data or {}
        pipeline_started = time_module.perf_counter()

        await apply_server_game_action(
            room=room,
            stored_state=stored,
            new_state=state,
            player_color=self.player_color,
            action=action,
            result=result,
            on_timeout=_on_timeout,
            on_reschedule_timeout=_on_reschedule_timeout,
            on_opening_result=_on_opening_result,
            on_game_over=_on_game_over,
            on_state_update=_on_state_update,
            on_turn_notice=_on_turn_notice,
        )

        pipeline_ms = int(
            (time_module.perf_counter() - pipeline_started) * 1000
        )

        intent_total_ms = int(
            (time_module.perf_counter() - intent_started) * 1000
        )

        if pre_pipeline_ms >= SLOW_DISPATCH_MS:
            logger.warning(
                "SLOW_WS_INTENT_PREPIPELINE "
                "room=%s player=%s action=%s "
                "room_ms=%s game_state_ms=%s engine_action_ms=%s "
                "pre_pipeline_ms=%s pipeline_ms=%s total_ms=%s",
                self.room_id,
                self.player_color,
                action,
                intent_room_ms,
                game_state_ms,
                engine_action_ms,
                pre_pipeline_ms,
                pipeline_ms,
                intent_total_ms,
            )

        if intent_total_ms >= SLOW_DISPATCH_MS:
            logger.warning(
                "SLOW_WS_INTENT_TOTAL "
                "room=%s player=%s action=%s "
                "room_ms=%s game_state_ms=%s engine_action_ms=%s "
                "pre_pipeline_ms=%s pipeline_ms=%s total_ms=%s",
                self.room_id,
                self.player_color,
                action,
                intent_room_ms,
                game_state_ms,
                engine_action_ms,
                pre_pipeline_ms,
                pipeline_ms,
                intent_total_ms,
            )

    async def _handle_roll_intent(self, engine):
        """Roll during the opening or a normal turn.

        Every die comes from the trusted Elixir dice service. The opening pair
        is fetched once (opening URL, never doubles) and stored hidden in
        `state['openingDice']`; each player taps to reveal their own die. Normal
        turn rolls use the normal URL.
        """
        state = engine.state
        # Recover games that were saved by the old opening flow after it had
        # cleared the deciding dice. This roll intent restores those dice; it
        # must never fetch a second roll for the opening winner.
        if engine.has_interrupted_opening_move():
            return engine.activate_opening_move(allow_interrupted=True)
        if state.get('phase') == 'opening_roll':
            if state.get('turn') != self.player_color:
                return {'success': False, 'message': 'Not your turn to roll'}
            seed = state.get('openingDice')
            if not seed:
                try:
                    white, black = await fetch_opening_dice()
                except DiceServiceError as exc:
                    logger.error(
                        "Dice service failed for opening roll: %s", exc)
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
        """(Re)arm the countdown from opening_result to the first move."""
        if getattr(self, '_opening_watch_task', None):
            self._opening_watch_task.cancel()
        self._opening_watch_task = asyncio.create_task(
            self._opening_result_watch())

    async def _opening_result_watch(self):
        await asyncio.sleep(GameConsumer.OPENING_RESULT_DELAY)
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            return

        gs = await get_game_state(room)
        stored = dict(gs.state_data or {})
        state = dict(stored)

        if state.get('phase') != 'opening_result':
            return

        engine = BackgammonEngine(state)
        result = engine.activate_opening_move()

        if not result.get('success'):
            logger.warning(
                "Could not activate opening dice: room=%s message=%s",
                self.room_id,
                result.get('message'),
            )
            return

        state = engine.state

        sequence = await record_event_and_advance(
            room,
            None,
            'opening_result_done',
            state,
        )
        state['version'] = sequence

        # The opening dice are the winner's first playable roll.
        # Start the clock and inactivity window only after the
        # opening-result banner has finished.
        now_ms = int(time_module.time() * 1000)

        clock, turn_started_at, new_active, timed_out, _deadline = compute_clock(
            stored,
            state,
            now_ms,
            room.time_control,
            room.target_points,
        )

        if clock is not None:
            state['clock'] = clock
            state['turnStartedAt'] = turn_started_at

        inactivity_refreshed = refresh_after_action(
            state,
            now_ms,
        )

        # Persist inactivity before creating its scheduled check.
        gs.state_data = state
        await save_game_state(gs)

        if timed_out and new_active:
            winner = 'black' if new_active == 'white' else 'white'
            await self._forfeit_on_time(winner, new_active)
            return

        if inactivity_refreshed is not None:
            task_created = await database_sync_to_async(
                ensure_inactivity_check
            )(room.id)

            logger.info(
                "INACTIVITY_OPENING_ARMED "
                "room_id=%s player=%s created=%s inactivity=%s",
                room.id,
                active_player(state),
                task_created,
                state.get('inactivity'),
            )

        await self._reschedule_timeout_from_state()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': state,
                'playerColor': None,
            },
        )

    async def _handle_give_up(self):
        """Handle player giving up voluntarily, routed through finalize_room."""
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            logger.warning(
                f"WS give_up on non-active game: room={self.room_id} status={getattr(room, 'status', '?')}")
            return await self._send_error('No active game')

        winner = 'black' if self.player_color == 'white' else 'white'
        logger.info(
            f"WS give_up: {self.player_color} forfeits, winner={winner} room={self.room_id}")

        game_state = await get_game_state(room)
        state = dict(game_state.state_data or {})
        loser_home = (state.get('home') or {}).get(self.player_color, 0)
        win_type = 'gammon' if loser_home == 0 else 'single'
        from .formats import forfeit_win_type
        win_type = forfeit_win_type(
            state, self.player_color, win_type, reason='give_up')
        state['phase'] = 'game_over'
        state['winner'] = winner
        state['winType'] = win_type

        await self._finalize_and_broadcast(state, winner, win_type, 'give_up')

    async def _handle_leave(self):
        """Cancel a waiting room or forfeit the entire active match."""
        room = await get_room(self.room_id)

        if room is None:
            await self._send_leave_error('room_not_found')
            return

        if room.status in ('waiting', 'cancelled'):
            try:
                result = await database_sync_to_async(cancel_waiting_room)(
                    room_id=self.room_id,
                    user_id=self.user_id,
                )
            except RoomCancellationError as exc:
                # A rejected cancellation must not become a forfeit.
                await self._send_leave_error(exc.code)
                return

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'room_cancelled',
                    'payload': result,
                },
            )
            return

        if room.status != 'playing':
            await self._send_leave_error('room_not_active')
            return

        # The opponent does not need to be connected to accept a forfeit.
        winner = 'black' if self.player_color == 'white' else 'white'

        logger.info(
            "WS leave: %s quits, winner=%s room=%s",
            self.player_color,
            winner,
            self.room_id,
        )

        game_state = await get_game_state(room)
        state = dict(game_state.state_data or {})

        from .formats import forfeit_win_type

        state['phase'] = 'game_over'
        state['winner'] = winner
        state['winType'] = forfeit_win_type(
            state,
            self.player_color,
            reason='leave',
        )
        state['gameEndReason'] = 'leave'

        await self._finalize_and_broadcast(
            state,
            winner,
            state['winType'],
            'leave',
            force_close=True,
        )

    async def _send_leave_error(self, code):
        """Send a stable error code for client-side translation."""
        await self.send(json.dumps({
            'type': 'error',
            'payload': {
                'action': 'leave',
                'code': code,
                'message': code,
            },
        }))

    async def room_cancelled(self, event):
        """Forward a confirmed cancellation to this connection."""
        await self.send(json.dumps({
            'type': 'room_cancelled',
            'payload': event['payload'],
        }))

    async def _handle_game_ended(self, payload):
        """Receive a client game_ended signal and finalize the room."""
        room = await get_room(self.room_id)
        if not room:
            logger.warning(f"WS game_ended for missing room: {self.room_id}")
            return await self._send_error('Room not found')

        game_state = await get_game_state(room)
        state = dict(game_state.state_data or {})
        if state.get('gameFormat') in ('match', 'money') or await is_linked_room(room.id):
            # Linked legacy rooms also require server intents and clock outcomes.
            return await self._send_error('Results are determined by the server')
        winner = payload.get('winner') or state.get('winner')
        win_type = payload.get('winType', 'single') or state.get(
            'winType', 'single')
        reason = payload.get('reason', 'game_ended')
        if payload.get('cube') is not None:
            state['cube'] = payload['cube']
        if state.get('doublingEnabled') is False:
            state['cube'] = 1

        if winner:
            state['phase'] = 'game_over'
            state['winner'] = winner
            state['winType'] = win_type
            await self._finalize_and_broadcast(state, winner, win_type, reason)
        else:
            logger.warning(
                f"WS game_ended without winner: room={self.room_id} payload={payload}")

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

        admin_review_pending = await database_sync_to_async(
            needs_admin_adjudication
        )(room)

        if admin_review_pending:
            return {'success': False, 'message': 'No active game'}
        doubling_enabled = state.get('doublingEnabled', True)
        engine.state = BackgammonEngine.get_initial_state()
        engine.state['doublingEnabled'] = doubling_enabled
        from .formats import carry_contract
        carry_contract(state, engine.state, room)
        # Match-level clock: remaining time survives, turnStartedAt does not (no charge for transition)
        if 'clock' in state and isinstance(state['clock'], dict):
            engine.state['clock'] = dict(state['clock'])
        engine.state['turnStartedAt'] = None
        engine.state['message'] = 'New game started'
        return {'success': True}

    async def _get_rematch_link(self, room):
        from .link.models import TournamentLink
        return await database_sync_to_async(
            lambda: TournamentLink.objects.filter(room_id=room.id).first()
        )()

    async def _send_rematch_status(self, status, extra=None):
        payload = {'status': status}
        if extra:
            payload.update(extra)
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'rematch_status_msg', 'payload': payload}
        )

    async def _send_rematch_status_to_self(self, status, extra=None):
        payload = {'status': status}
        if extra:
            payload.update(extra)
        await self.send(json.dumps({'type': 'rematch_status', 'payload': payload}))

    async def _rematch_guards(self, room, gs):
        # room must be completed, final result persisted
        if not room or room.status != 'completed':
            await self._send_rematch_status_to_self('unavailable', {'reason': 'not_completed'})
            return None, None, False
        state = gs.state_data or {}
        if state.get('phase') != 'game_over' or not state.get('winner'):
            await self._send_rematch_status_to_self('unavailable', {'reason': 'not_completed'})
            return None, None, False
        # both players must be connected (fresh presence)
        both = await database_sync_to_async(both_players_connected)(room)
        if not both:
            await self._send_rematch_status_to_self('unavailable', {'reason': 'opponent_left'})
            return None, None, False
        link = await self._get_rematch_link(room)
        # tournament guard
        if link is not None and link.tournament_id != 0:
            await self._send_rematch_status_to_self('unavailable', {'reason': 'tournament'})
            return None, None, False
        return link, state, True

    async def _handle_rematch_request(self):
        room = await get_room(self.room_id)
        gs = await get_game_state(room) if room else None
        if not room or not gs:
            return await self._send_error('Room not found')
        link, _state, ok = await self._rematch_guards(room, gs)
        if not ok:
            return
        # direct play
        if link is not None and link.tournament_id == 0 and link.fixture_id < 0:
            try:
                result = await database_sync_to_async(send_direct_play_rematch_action, thread_sensitive=False)(
                    link=link, room=room, actor_color=self.player_color, action='request'
                )
            except RematchServiceError as exc:
                code = getattr(exc, "code", None)
                if code == 'requester_not_eligible':
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'requester_not_eligible'})
                elif code == 'opponent_not_eligible':
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'opponent_not_eligible'})
                elif code in ('source_not_settled', 'settlement_pending'):
                    await self._send_rematch_status_to_self(
                        'creating',
                        {'reason': 'source_not_settled'},
                    )
                elif code == 'source_room_mismatch':
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'source_room_mismatch'})
                elif code == 'invalid_source':
                    await self._send_rematch_status_to_self(
                        'unavailable',
                        {'reason': 'invalid_source'},
                    )
                else:
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'service_error'})
                return
            # tournament backend decides pending/declined etc
            # broadcast requested/offered
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'rematch_offer_msg', 'requesterColor': self.player_color}
            )
            return
        # plain private
        # store pending marker in room.state

        def _set_pending():
            with transaction.atomic():
                r = GameRoom.objects.select_for_update().get(pk=room.id)
                s = dict(r.state or {})
                if s.get('rematch') and s['rematch'].get('status') == 'pending':
                    return s['rematch']
                s['rematch'] = {'status': 'pending',
                                'requester': self.player_color}
                r.state = s
                r.save(update_fields=['state'])
                return s['rematch']
        await database_sync_to_async(_set_pending)()
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'rematch_offer_msg', 'requesterColor': self.player_color}
        )

    async def _handle_rematch_accept(self):
        room = await get_room(self.room_id)
        gs = await get_game_state(room) if room else None
        if not room or not gs:
            return await self._send_error('Room not found')
        link, _state, ok = await self._rematch_guards(room, gs)
        if not ok:
            return
        if link is not None and link.tournament_id == 0 and link.fixture_id < 0:
            try:
                result = await database_sync_to_async(send_direct_play_rematch_action, thread_sensitive=False)(
                    link=link, room=room, actor_color=self.player_color, action='accept'
                )
            except RematchServiceError as exc:
                code = getattr(exc, "code", None)
                if code == "requester_not_eligible":
                    # acceptor is requester_not_eligible
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': self.player_color, 'payload': {
                            'status': 'unavailable', 'reason': 'requester_not_eligible'}}
                    )
                    other_color = 'black' if self.player_color == 'white' else 'white'
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': other_color, 'payload': {
                            'status': 'unavailable', 'reason': 'opponent_not_eligible'}}
                    )
                elif code == "opponent_not_eligible":
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': self.player_color, 'payload': {
                            'status': 'unavailable', 'reason': 'opponent_not_eligible'}}
                    )
                    other_color = 'black' if self.player_color == 'white' else 'white'
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {'type': 'rematch_status_targeted_msg', 'targetColor': other_color, 'payload': {
                            'status': 'unavailable', 'reason': 'requester_not_eligible'}}
                    )
                elif code in ('source_not_settled', 'settlement_pending'):
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'source_not_settled'})
                elif code == 'source_room_mismatch':
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'service_error'})
                else:
                    await self._send_rematch_status_to_self('unavailable', {'reason': 'service_error'})
                return
            # expect tickets
            tickets = result.get('tickets') if isinstance(
                result, dict) else None
            if not tickets or 'p1' not in tickets or 'p2' not in tickets:
                await self._send_rematch_status_to_self('unavailable', {'reason': 'service_error'})
                return
            # map to colors
            p1_color = link.color_for_seat('p1')
            p2_color = link.color_for_seat('p2')
            # send each player only its ticket
            for color, ticket in [('p1', tickets['p1']), ('p2', tickets['p2'])]:
                target_color = p1_color if color == 'p1' else p2_color
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'rematch_ready_msg',
                        'targetColor': target_color, 'ticket': ticket}
                )
            return
        # plain private
        # verify pending exists and requester is opponent

        def _check_and_create():
            with transaction.atomic():
                r = GameRoom.objects.select_for_update().get(pk=room.id)
                s = dict(r.state or {})
                rem = s.get('rematch')
                if not rem or rem.get('status') != 'pending':
                    return None, 'no_pending'
                if rem.get('requester') == self.player_color:
                    return None, 'cannot_accept_own'
                # create new room
                from .game_service import create_private_rematch_room
                new_room = create_private_rematch_room(r)
                # clear rematch marker from old room
                s.pop('rematch', None)
                r.state = s
                r.save(update_fields=['state'])
                return new_room, None
        result = await database_sync_to_async(_check_and_create)()
        if result[0] is None:
            await self._send_rematch_status_to_self('unavailable', {'reason': result[1]})
            return
        new_room = result[0]
        # send each player roomId/color
        for rp in await database_sync_to_async(lambda: list(new_room.players.select_related('player').all()))():
            col = rp.color
            payload = {'roomId': str(new_room.id), 'color': col}
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_ready_msg', 'roomId': payload['roomId'], 'color': col, 'targetColor': col}
            )

    async def _handle_rematch_decline(self):
        room = await get_room(self.room_id)
        if not room:
            return
        link = await self._get_rematch_link(room)
        if link is not None and link.tournament_id == 0 and link.fixture_id < 0:
            try:
                await database_sync_to_async(send_direct_play_rematch_action, thread_sensitive=False)(
                    link=link, room=room, actor_color=self.player_color, action='decline'
                )
            except RematchServiceError:
                pass
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'declined'}}
            )
            await asyncio.sleep(0.5)
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'available'}}
            )
            return
        # plain

        def _clear():
            with transaction.atomic():
                r = GameRoom.objects.select_for_update().get(pk=room.id)
                s = dict(r.state or {})
                s.pop('rematch', None)
                r.state = s
                r.save(update_fields=['state'])
        await database_sync_to_async(_clear)()
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'rematch_status_msg', 'payload': {'status': 'declined'}}
        )
        await asyncio.sleep(0.5)
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'rematch_status_msg', 'payload': {'status': 'available'}}
        )

    async def _handle_rematch_cancel(self):
        room = await get_room(self.room_id)
        if not room:
            return
        link = await self._get_rematch_link(room)
        if link is not None and link.tournament_id == 0 and link.fixture_id < 0:
            try:
                await database_sync_to_async(send_direct_play_rematch_action, thread_sensitive=False)(
                    link=link, room=room, actor_color=self.player_color, action='cancel'
                )
            except RematchServiceError:
                pass
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'cancelled'}}
            )
            await asyncio.sleep(0.3)
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'available'}}
            )
            return

        def _clear_if_requester():
            with transaction.atomic():
                r = GameRoom.objects.select_for_update().get(pk=room.id)
                s = dict(r.state or {})
                rem = s.get('rematch')
                if rem and rem.get('requester') == self.player_color:
                    s.pop('rematch', None)
                    r.state = s
                    r.save(update_fields=['state'])
                    return True
                return False
        cleared = await database_sync_to_async(_clear_if_requester)()
        if cleared:
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'cancelled'}}
            )
            await asyncio.sleep(0.3)
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'rematch_status_msg', 'payload': {'status': 'available'}}
            )

    async def rematch_status_msg(self, event):
        await self.send(json.dumps({'type': 'rematch_status', 'payload': event['payload']}))

    async def rematch_status_targeted_msg(self, event):
        if event.get("targetColor") != self.player_color:
            return
        await self.send(json.dumps({'type': 'rematch_status', 'payload': event['payload']}))

    async def rematch_offer_msg(self, event):
        requester = event.get('requesterColor')
        if requester == self.player_color:
            await self.send(json.dumps({'type': 'rematch_status', 'payload': {'status': 'requested', 'requesterColor': requester}}))
        else:
            await self.send(json.dumps({'type': 'rematch_status', 'payload': {'status': 'offered', 'requesterColor': requester}}))

    async def rematch_ready_msg(self, event):
        # For direct play ticket, only send to targetColor
        target = event.get('targetColor')
        if target is not None and target != self.player_color:
            return
        payload = {}
        if 'ticket' in event:
            payload['ticket'] = event['ticket']
        if 'roomId' in event:
            payload['roomId'] = event['roomId']
            payload['color'] = event['color']
        await self.send(json.dumps({'type': 'rematch_ready', 'payload': payload}))

    async def _finalize_and_broadcast(self, state, winner, win_type, reason, force_close=False):
        """Score the finished game and broadcast game_ended to the room.

        Normal endings route through `record_game_end`, which keeps the room
        open across games until a player reaches `target_points`. `force_close`
        ends the whole series for leaving, timeout, or disconnection.
        """
        room = await get_room(self.room_id)
        if not room:
            return
        gs = await get_game_state(room)
        stored = gs.state_data or {}
        if stored.get('matchScored') and not (
            force_close and reason == 'leave' and stored.get(
                'gameFormat') == 'match'
        ):
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
        # The scoring service saves matchScored in the same transaction as
        # the score; never overwrite it here with this connection's snapshot.
        await database_sync_to_async(room.refresh_from_db)()
        scored = await get_game_state(room)
        state = dict(scored.state_data or {})
        winner = state.get('winner', winner)
        win_type = state.get('winType', win_type)
        reason = state.get('gameEndReason', reason)
        payload = game_ended_payload(state, winner, win_type, reason, room)
        payload['matchOver'] = match_over
        payload['nextGame'] = not match_over
        if not match_over:
            payload['nextGameIn'] = int(GameConsumer.NEXT_GAME_DELAY)
            await self._arm_auto_next_game()
        logger.info(
            f"WS game_ended: room={self.room_id} winner={winner} win_type={win_type} reason={reason} match_over={match_over}")
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
        payload['nextGameIn'] = self._remaining_next_game_seconds()
        # Make sure the auto-start countdown is still armed for the room.
        if self.room_group_name not in _auto_next_tasks:
            await self._arm_auto_next_game()
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_ended', 'payload': payload},
        )

    async def _replay_finalized_game_end(self, state, room):
        """Re-broadcast the final result for a room that is already closed.

        Used when a returning player lands on a completed/cancelled room whose
        game was finalized earlier (leave, forfeit, or target reached): the
        recorded result is replayed so the UI shows who won and why.
        """
        winner = state.get('winner')
        if not winner:
            return
        reason = state.get('gameEndReason', 'state_update')
        payload = game_ended_payload(
            state, winner, state.get('winType', 'single'), reason, room
        )
        payload['matchOver'] = True
        payload['nextGame'] = False
        if reason == 'admin':
            payload['adminReason'] = state.get('adminEndReason', '')
        logger.info(
            f"WS replay finalized game_ended: room={self.room_id} winner={winner} reason={reason}")
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_ended', 'payload': payload},
        )

    def _remaining_next_game_seconds(self):
        """Whole seconds left before the server auto-starts the next game."""
        deadline = _auto_next_deadlines.get(self.room_group_name)
        if deadline is None:
            return int(GameConsumer.NEXT_GAME_DELAY)
        remaining = max(1, (deadline - int(time_module.time() * 1000)) // 1000)
        return int(min(remaining, GameConsumer.NEXT_GAME_DELAY))

    async def _arm_auto_next_game(self):
        """(Re)schedule the room's auto-start for the next game of the match."""
        if self.room_group_name in _auto_next_tasks:
            _auto_next_tasks[self.room_group_name].cancel()
        delay = GameConsumer.NEXT_GAME_DELAY
        _auto_next_deadlines[self.room_group_name] = (
            int(time_module.time() * 1000) + int(delay * 1000)
        )
        task = asyncio.create_task(
            self._auto_next_game_watch(delay),
            name=f'auto_next_{self.room_group_name}',
        )
        _auto_next_tasks[self.room_group_name] = task

    async def _auto_next_game_watch(self, delay):
        """Wait out the countdown, then start the next game of the match."""
        try:
            await asyncio.sleep(delay)
            await self._start_next_game()
        except Exception:
            logger.exception("WS auto next game failed",
                             extra={"room_id": self.room_id})
        finally:
            _auto_next_tasks.pop(self.room_group_name, None)
            _auto_next_deadlines.pop(self.room_group_name, None)

    async def _start_next_game(self):
        """Start the next game of a match, mirroring the `next_game` intent."""
        room = await get_room(self.room_id)
        if not room or room.status != 'playing':
            return

        admin_review_pending = await database_sync_to_async(
            needs_admin_adjudication
        )(room)

        if admin_review_pending:
            return
        gs = await get_game_state(room)
        stored = dict(gs.state_data or {})
        if stored.get('phase') != 'game_over' or not stored.get('winner'):
            return
        if not stored.get('matchScored'):
            return
        engine = BackgammonEngine(stored)
        result = await self._handle_next_game(engine)
        if not result.get('success'):
            return

        state = engine.state
        sequence = await record_event_and_advance(room, None, 'next_game', state)
        state['version'] = sequence

        now_ms = int(time_module.time() * 1000)
        clock, turn_started_at, new_active, timed_out, _deadline = compute_clock(
            stored, state, now_ms, room.time_control, room.target_points
        )
        if clock is not None:
            state['clock'] = clock
            state['turnStartedAt'] = turn_started_at

        gs.state_data = state
        await save_game_state(gs)

        if clock is not None and new_active:
            await self._reschedule_timeout_from_state()

        logger.info(f"WS auto next game started: room={self.room_id}")
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': state,
                'playerColor': None,
            }
        )

    async def game_ended(self, event):
        payload = event.get('payload') or {}
        logger.info(
            'WS_GROUP_GAME_ENDED_RECEIVED room_id=%s winner=%s reason=%s',
            getattr(self, 'room_id', None),
            payload.get('winner') if isinstance(payload, dict) else None,
            payload.get('reason') if isinstance(payload, dict) else None,
        )
        await self.send(json.dumps({
            'type': 'game_ended',
            'payload': event.get('payload'),
        }))
        logger.info(
            'WS_GAME_ENDED_SENT room_id=%s winner=%s reason=%s',
            getattr(self, 'room_id', None),
            payload.get('winner') if isinstance(payload, dict) else None,
            payload.get('reason') if isinstance(payload, dict) else None,
        )

    async def admin_score_updated(self, event):
        await self.send(json.dumps({
            'type': 'admin_score_updated',
            'payload': event.get('payload'),
        }))

    async def admin_match_ended(self, event):
        for task_name in (
            '_timeout_task', '_opening_watch_task', '_presence_heartbeat_task'
        ):
            task = getattr(self, task_name, None)
            if task:
                task.cancel()
        incoming = dict(event.get('payload') or {})
        payload = {
            **incoming,
            'reason': 'admin',
            'adminReason': incoming.get('adminReason') or incoming.get('reason', ''),
            'matchOver': True,
            'nextGame': False,
        }
        await self.send(json.dumps({'type': 'game_ended', 'payload': payload}))
        await self.close(code=1000)

    async def _schedule_timeout(self, deadline_ms, active_color):
        """(Re)schedule a deadline watch for the active player."""
        if getattr(self, '_timeout_task', None):
            self._timeout_task.cancel()
        if deadline_ms is None or deadline_ms <= 0:
            return
        self._timeout_task = asyncio.create_task(
            self._timeout_watch(deadline_ms / 1000.0, active_color))

    async def _timeout_watch(self, deadline, active_color):
        delay = deadline - time_module.time()
        if delay > 0:
            await asyncio.sleep(delay)
        room = await get_room(self.room_id)
        if not room:
            return
        if await database_sync_to_async(needs_admin_adjudication)(room):
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

        admin_review_pending = await database_sync_to_async(
            needs_admin_adjudication
        )(room)

        if admin_review_pending:
            return
        gs = await get_game_state(room)
        stored = gs.state_data or {}
        active = active_player(stored)
        if not active or stored.get('phase') == 'game_over':
            return
        deadline = deadline_for(stored, room.time_control, room.target_points)
        await self._schedule_timeout(deadline, active)

    async def _forfeit_on_time(self, winner, loser):
        """Mark the game over because `loser` ran out of time and broadcast it."""
        room = await get_room(self.room_id)
        if not room:
            return
        if await database_sync_to_async(needs_admin_adjudication)(room):
            return
        gs = await get_game_state(room)
        stored = dict(gs.state_data or {})
        if stored.get('phase') == 'game_over':
            return
        stored['phase'] = 'game_over'
        stored['winner'] = winner
        from .formats import forfeit_win_type
        stored['winType'] = forfeit_win_type(stored, loser, reason='time')
        clock = dict(stored.get('clock') or {})
        if clock:
            clock[loser] = 0
            stored['clock'] = clock
        stored['turnStartedAt'] = None
        stored['message'] = f'{loser} ran out of time'
        logger.info(
            f"WS timeout forfeit: loser={loser} winner={winner} room={self.room_id}")
        await self._finalize_and_broadcast(
            stored, winner, stored['winType'], 'time', force_close=True
        )

    async def _send_error(self, message, action=None):
        response = {
            'type': 'error',
            'message': message
        }
        if action:
            response['action'] = action
        await self.send(json.dumps(response))

    async def _broadcast_room_status(self):
        """Broadcast the number of connected users to the room."""
        connected = _connected_users.get(self.room_group_name, {})
        colors = list(_connected_user_colors.get(
            self.room_group_name, {}).values())
        count = len(connected)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'room_status',
                'connected': count,
                'connectedColors': colors,
            }
        )

    async def game_message(self, event):
        if event.get('event_type') == 'state_update':
            payload = event.get('payload') or {}
            inactivity = payload.get('inactivity') if isinstance(
                payload, dict) else None
            has_inactivity = isinstance(inactivity, dict)
            logger.info(
                'WS_GROUP_STATE_UPDATE_RECEIVED room_id=%s user=%s action=%s version=%s has_inactivity=%s warnedAtMs=%s deadlineMs=%s',
                getattr(self, 'room_id', None),
                getattr(self, 'user_id', None),
                event.get('action'),
                payload.get('version') if isinstance(payload, dict) else None,
                has_inactivity,
                inactivity.get('warnedAtMs') if has_inactivity else None,
                inactivity.get('deadlineMs') if has_inactivity else None,
            )
            logger.info(
                'WS_STATE_UPDATE_SENT room_id=%s user=%s version=%s',
                getattr(self, 'room_id', None),
                getattr(self, 'user_id', None),
                payload.get('version') if isinstance(payload, dict) else None,
            )
        message = {
            'type': event['event_type'],
            'payload': event['payload'],
            'playerColor': event['playerColor'],
        }
        if event.get('action'):
            message['action'] = event['action']
        await self.send(json.dumps(message))

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
                'connectedColors': event.get('connectedColors', []),
            }
        }))

    async def room_started(self, event):
        await self.send(json.dumps({'type': 'room_started', 'payload': {}}))
