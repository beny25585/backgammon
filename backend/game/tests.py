import asyncio
import time as time_module
import uuid
from typing import Any, cast
from urllib.parse import urlencode

from channels.testing import WebsocketCommunicator
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework.test import APIClient

from game.consumers import GameConsumer, get_game_state, save_game_state, get_user_id_from_token
from game.engine import BackgammonEngine
from game.game_service import finalize_room
from game.models import GameRoom, GameState, GameEvent, Match, Player, RoomPlayer


class TokenParsingTests(TestCase):
    def test_get_user_id_from_token_returns_none_for_invalid_token(self):
        self.assertIsNone(get_user_id_from_token("not-a-valid-token"))


class GameConsumerTests(TransactionTestCase):
    def setUp(self):
        self.white_user = User.objects.create_user(username="white", password="pass")
        self.black_user = User.objects.create_user(username="black", password="pass")
        self.stranger = User.objects.create_user(username="stranger", password="pass")
        self.white_player = Player.objects.create(user=self.white_user)
        self.black_player = Player.objects.create(user=self.black_user)
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="ABCDEF",
            status="playing",
        )
        RoomPlayer.objects.create(room=self.room, player=self.white_player, color="white")
        RoomPlayer.objects.create(room=self.room, player=self.black_player, color="black")
        GameState.objects.create(room=self.room, state_data={})
        self.room_id = str(self.room.id)

    def _make_token(self, user):
        return str(AccessToken.for_user(user))

    def _make_communicator(self, user):
        token = self._make_token(user)
        query = urlencode({"token": token})
        communicator = WebsocketCommunicator(
            GameConsumer.as_asgi(),
            f"/ws/game/{self.room_id}/?{query}",
        )
        # Set url_route manually since we're connecting directly to the consumer
        # without going through URLRouter
        cast(Any, communicator.scope)["url_route"] = {
            "kwargs": {"room_id": self.room_id},
            "args": (),
        }
        return communicator

    async def _receive_until(self, communicator, predicate):
        """Receive messages, skipping room_status, until a message matches predicate."""
        while True:
            event = await communicator.receive_json_from()
            if predicate(event):
                return event

    async def test_white_player_connects_with_persistent_color(self):
        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")

        await communicator.disconnect()

    async def test_black_player_connects_with_persistent_color(self):
        communicator = self._make_communicator(self.black_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "black")

        await communicator.disconnect()

    async def test_reconnect_uses_same_color(self):
        comm1 = self._make_communicator(self.white_user)
        await comm1.connect(timeout=10)
        await comm1.receive_json_from()
        await comm1.disconnect()

        comm2 = self._make_communicator(self.white_user)
        connected, _ = await comm2.connect(timeout=10)
        self.assertTrue(connected)

        response = await comm2.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")

        await comm2.disconnect()

    async def test_initial_state_update_includes_player_usernames(self):
        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["players"], {"white": "white", "black": "black"})

        await communicator.disconnect()

    async def test_player_joined_broadcast_includes_username(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)

        # Black will receive state_update first, then own player_joined
        await comm_black.receive_json_from()  # state_update
        await comm_black.receive_json_from()  # player_joined (own broadcast)

        # White should receive player_joined for black
        event = await self._receive_until(comm_white, lambda e: e.get("payload", {}).get("username") == "black")
        self.assertEqual(event["type"], "player_joined")
        self.assertEqual(event["payload"]["playerColor"], "black")
        self.assertEqual(event["payload"]["username"], "black")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_disconnect_broadcasts_player_disconnected(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()  # state_update
        await comm_black.receive_json_from()  # player_joined (own broadcast)
        # white gets black's player_joined
        await comm_white.receive_json_from()  # player_joined (black)

        await comm_black.disconnect()

        event = await self._receive_until(comm_white, lambda e: e.get("type") == "player_disconnected")
        self.assertEqual(event["type"], "player_disconnected")
        self.assertEqual(event["payload"]["playerColor"], "black")

        await comm_white.disconnect()

    async def test_both_players_connected_broadcasts_player_joined(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()  # state_update
        await comm_black.receive_json_from()  # player_joined (own broadcast)

        event = await self._receive_until(comm_white, lambda e: e.get("payload", {}).get("username") == "black")
        self.assertEqual(event["type"], "player_joined")
        self.assertEqual(event["payload"]["playerColor"], "black")
        self.assertEqual(event["payload"]["username"], "black")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_unassigned_user_is_rejected(self):
        communicator = self._make_communicator(self.stranger)
        connected, _ = await communicator.connect(timeout=10)
        self.assertFalse(connected)

    async def test_reconnect_after_disconnect_restores_color(self):
        comm1 = self._make_communicator(self.white_user)
        await comm1.connect(timeout=10)
        await comm1.receive_json_from()
        await comm1.disconnect()

        comm2 = self._make_communicator(self.white_user)
        connected, _ = await comm2.connect(timeout=10)
        self.assertTrue(connected)

        response = await comm2.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")
        self.assertIsNotNone(response["payload"])

        await comm2.disconnect()

    async def test_state_update_records_event_and_broadcasts_version(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()  # state_update (initial)
        await comm_black.receive_json_from()  # player_joined
        await comm_white.receive_json_from()  # player_joined (black)

        payload = {"state": {"phase": "moving", "turn": "white", "version": 0}, "action": "move"}
        await comm_white.send_json_to({
            "type": "state_update",
            "payload": payload,
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "state_update" and not e.get("initial"))
        self.assertEqual(event["type"], "state_update")
        self.assertEqual(event["payload"]["version"], 1)
        self.assertEqual(event["payload"]["phase"], "moving")

        result = await database_sync_to_async(
            lambda: (
                (ge := GameEvent.objects.filter(room=self.room, sequence=1).first()),
                ge.event_type if ge else None,
                ge.player.color if ge and ge.player else None,
            )
        )()
        ge, event_type, player_color = result
        self.assertIsNotNone(ge)
        self.assertEqual(event_type, "move")
        self.assertEqual(player_color, "white")

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_stale_state_update_is_dropped(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()  # state_update (initial)
        await comm_black.receive_json_from()  # player_joined
        await comm_white.receive_json_from()  # player_joined (black)

        # Advance sequence to 2 via two real updates.
        for seq in (1, 2):
            await comm_white.send_json_to({
                "type": "state_update",
                "payload": {"state": {"phase": "moving", "turn": "white", "version": seq - 1}, "action": "move"},
            })
            event = await self._receive_until(comm_black, lambda e: e.get("type") == "state_update" and not e.get("initial"))
            self.assertEqual(event["payload"]["version"], seq)

        # Stale update (version 1, room is now at 2) must be dropped: no sequence
        # bump, no event recorded, no broadcast.
        await comm_white.send_json_to({
            "type": "state_update",
            "payload": {"state": {"phase": "moving", "turn": "white", "version": 1}, "action": "move"},
        })
        await asyncio.sleep(0.5)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 2)
        stale_count = await database_sync_to_async(
            lambda: GameEvent.objects.filter(room=self.room).count()
        )()
        self.assertEqual(stale_count, 2)

        await comm_white.disconnect()
        await comm_black.disconnect()


    async def _connect_both(self):
        """Connect both players and drain up to white seeing black join."""
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined (own)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()  # state_update (initial)
        await comm_black.receive_json_from()  # player_joined (own)

        while True:
            event = await comm_white.receive_json_from()
            if event.get('type') == 'player_joined' and event.get('payload', {}).get('username') == 'black':
                break
        return comm_white, comm_black

    async def test_initial_state_update_includes_time_control(self):
        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)
        response = await communicator.receive_json_from()
        self.assertEqual(response['type'], 'state_update')
        self.assertEqual(response['timeControl'], self.room.time_control)
        await communicator.disconnect()

    async def test_initial_state_update_computes_clock_and_turn_started_at(self):
        state = {
            'phase': 'moving',
            'turn': 'white',
            'version': 1,
        }
        gs = await get_game_state(self.room)
        gs.state_data = state
        await save_game_state(gs)

        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response['type'], 'state_update')
        self.assertEqual(response['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertIsInstance(response['payload']['turnStartedAt'], int)
        await communicator.disconnect()

    async def test_first_state_update_seeds_clock_during_opening_roll(self):
        # During the opening roll nobody is on the clock: reserves are seeded
        # but the clock is not started (turnStartedAt stays null).
        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'opening_roll', 'turn': 'black', 'version': 0}, 'action': 'roll'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertIsNone(event['payload'].get('turnStartedAt'))
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_clock_starts_only_after_opening_roll_resolves(self):
        comm_white, comm_black = await self._connect_both()
        # Opening roll: no active player, clock not started.
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'opening_roll', 'turn': 'black', 'version': 0}, 'action': 'roll'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertIsNone(event['payload'].get('turnStartedAt'))

        # Opening roll resolves: white to move. The clock starts now, and the
        # time spent rolling is not charged to either player.
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'moving', 'turn': 'white', 'version': 1}, 'action': 'roll'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and e.get('payload', {}).get('phase') == 'moving')
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertIsInstance(event['payload'].get('turnStartedAt'), int)
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_client_sent_clock_is_overwritten(self):
        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {
                'phase': 'moving',
                'turn': 'black',
                'clock': {'white': 999_999_999, 'black': 999_999_999},
                'turnStartedAt': 0,
                'version': 0,
            }, 'action': 'move'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_turn_change_charges_only_beyond_delay(self):
        stored = {
            'phase': 'moving',
            'turn': 'white',
            'clock': {'white': 120_000, 'black': 120_000},
            # White has been thinking 15s; delay is 12s, so 3s should be charged.
            'turnStartedAt': int(time_module.time() * 1000) - 15_000,
        }
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        # white completes a move -> turn goes to black
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'moving', 'turn': 'black', 'version': 0}, 'action': 'move'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        clock = event['payload']['clock']
        self.assertEqual(clock['black'], 120_000)  # frozen while white acted
        self.assertTrue(116_000 <= clock['white'] <= 117_000)  # 120s - (15s - 12s)
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_timeout_when_remaining_time_already_expired(self):
        stored = {
            'phase': 'moving',
            'turn': 'white',
            'clock': {'white': 0, 'black': 180_000},
            'turnStartedAt': int(time_module.time() * 1000) - 5_000,
        }
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'moving', 'turn': 'white', 'version': 0}, 'action': 'move'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'game_ended')
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_deadline_task_forfeits_when_player_never_acts(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined (own)

        stored = {
            'phase': 'moving',
            'turn': 'white',
            'clock': {'white': 100, 'black': 120_000},
            # White's deadline is 12s delay + 100ms reserve after turnStartedAt;
            # put turnStartedAt in the past so the deadline is effectively now.
            'turnStartedAt': int(time_module.time() * 1000) - 12_100,
        }
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        # White never completes a move; the update just re-arms the deadline.
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'state': {'phase': 'moving', 'turn': 'white', 'version': 0}, 'action': 'move'},
        })
        event = await self._receive_until(comm_white, lambda e: e.get('type') == 'game_ended')
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        await comm_white.disconnect()


class FinalizeRoomTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="FINAL1",
            status="playing",
        )

    def _state(self, **overrides):
        state = BackgammonEngine.get_initial_state()
        state.update({
            'winner': 'white',
            'winType': 'single',
            'cube': 1,
            **overrides,
        })
        return state

    def test_finalize_room_scores_closes_and_saves_match(self):
        match = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertIsNotNone(match)
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(self.room.white_score, 1)
        self.assertEqual(self.room.black_score, 0)
        self.assertEqual(match.winner, 'white')
        self.assertEqual(match.match_type, 'online')
        self.assertEqual(match.games[0]['points_awarded'], 1)

    def test_finalize_room_applies_win_type_and_cube_multipliers(self):
        match = finalize_room(self.room, self._state(winType='gammon', cube=2), 'white', 'gammon', 'bear_off')

        self.room.refresh_from_db()
        self.assertEqual(self.room.white_score, 4)
        self.assertEqual(match.games[0]['points_awarded'], 4)

    def test_finalize_room_black_winner_scores_black(self):
        finalize_room(self.room, self._state(winner='black'), 'black', 'single', 'give_up')

        self.room.refresh_from_db()
        self.assertEqual(self.room.black_score, 1)
        self.assertEqual(self.room.white_score, 0)
        self.assertEqual(self.room.status, 'completed')

    def test_finalize_room_is_idempotent(self):
        first = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')
        second = finalize_room(self.room, self._state(), 'black', 'single', 'give_up')

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)
        self.room.refresh_from_db()
        self.assertEqual(self.room.white_score, 1)

    def test_finalize_room_ignores_cancelled_room(self):
        self.room.status = 'cancelled'
        self.room.save()

        match = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')
        self.assertIsNone(match)
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)


class TaskWorkerTests(TestCase):
    def test_expire_command_enqueues_task(self):
        from django.core.management import call_command
        from game.models import Task

        # Ensure no tasks exist
        Task.objects.all().delete()

        call_command('expire_waiting_rooms', '60', '--enqueue')

        task = Task.objects.filter(name='game.tasks.expire_waiting_rooms').first()
        self.assertIsNotNone(task)
        self.assertEqual(task.status, 'pending')

    def test_run_tasks_executes_expire(self):
        from django.core.management import call_command
        from django.utils import timezone
        from datetime import timedelta
        from game.models import Task, GameRoom

        # Create a waiting room older than 5 minutes
        import uuid as _uuid
        old_room = GameRoom.objects.create(code=_uuid.uuid4().hex[:6].upper(), status='waiting')
        past = timezone.now() - timedelta(minutes=120)
        GameRoom.objects.filter(pk=old_room.pk).update(updated_at=past)

        # Enqueue task to expire rooms (run now)
        task = Task.objects.create(
            name='game.tasks.expire_waiting_rooms',
            args=[60],
            run_at=timezone.now(),
        )

        call_command('run_tasks')

        old_room.refresh_from_db()
        task.refresh_from_db()

        self.assertEqual(old_room.status, 'cancelled')
        self.assertEqual(task.status, 'done')

class ExpireWaitingRoomsCommandTests(TestCase):
    def test_expire_waiting_rooms_command(self):
        from django.core.management import call_command
        from django.utils import timezone
        from datetime import timedelta

        # Create a waiting room and set updated_at in the past
        old_room = GameRoom.objects.create(code=uuid.uuid4().hex[:6].upper(), status='waiting')
        past = timezone.now() - timedelta(minutes=120)
        GameRoom.objects.filter(pk=old_room.pk).update(updated_at=past)

        # Create a recent waiting room that should not be expired
        recent_room = GameRoom.objects.create(code=uuid.uuid4().hex[:6].upper(), status='waiting')

        # Run the command to expire rooms older than 60 minutes
        call_command('expire_waiting_rooms', '60')

        old_room.refresh_from_db()
        recent_room.refresh_from_db()

        self.assertEqual(old_room.status, 'cancelled')
        self.assertEqual(recent_room.status, 'waiting')


class GameEndConsumerTests(TransactionTestCase):
    def setUp(self):
        self.white_user = User.objects.create_user(username="white", password="pass")
        self.black_user = User.objects.create_user(username="black", password="pass")
        self.white_player = Player.objects.create(user=self.white_user)
        self.black_player = Player.objects.create(user=self.black_user)
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="GAMEND",
            status="playing",
        )
        RoomPlayer.objects.create(room=self.room, player=self.white_player, color="white")
        RoomPlayer.objects.create(room=self.room, player=self.black_player, color="black")
        GameState.objects.create(room=self.room, state_data=BackgammonEngine.get_initial_state())
        self.room_id = str(self.room.id)

    def _make_token(self, user):
        return str(AccessToken.for_user(user))

    def _make_communicator(self, user):
        token = self._make_token(user)
        query = urlencode({"token": token})
        communicator = WebsocketCommunicator(
            GameConsumer.as_asgi(),
            f"/ws/game/{self.room_id}/?{query}",
        )
        cast(Any, communicator.scope)["url_route"] = {
            "kwargs": {"room_id": self.room_id},
            "args": (),
        }
        return communicator

    async def _receive_until(self, communicator, predicate):
        while True:
            event = await communicator.receive_json_from()
            if predicate(event):
                return event

    async def test_game_ended_message_finalizes_and_broadcasts(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()
        await comm_black.receive_json_from()
        await comm_white.receive_json_from()

        await comm_white.send_json_to({
            "type": "game_ended",
            "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "white")
        self.assertEqual(event["payload"]["reason"], "bear_off")
        self.assertEqual(event["payload"]["points"], 1)
        self.assertEqual(event["payload"]["whiteScore"], 1)
        self.assertEqual(event["payload"]["blackScore"], 0)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_game_ended_message_is_idempotent(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        payload = {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1}
        await comm_white.send_json_to({"type": "game_ended", "payload": payload})
        await comm_white.send_json_to({"type": "game_ended", "payload": payload})
        await asyncio.sleep(0.5)

        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

        await comm_white.disconnect()

    async def test_give_up_finalizes_room_and_broadcasts(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()
        await comm_black.receive_json_from()
        await comm_white.receive_json_from()

        await comm_white.send_json_to({"type": "give_up", "payload": {}})

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["reason"], "give_up")
        self.assertEqual(event["payload"]["loser"], "white")

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_state_update_with_game_over_finalizes_room(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()
        await comm_black.receive_json_from()
        await comm_white.receive_json_from()

        state = BackgammonEngine.get_initial_state()
        state["phase"] = "game_over"
        state["winner"] = "black"
        state["winType"] = "single"
        await comm_white.send_json_to({
            "type": "state_update",
            "payload": {"state": state, "action": "move"},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["reason"], "state_update")

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_connect_to_finished_game_auto_finalizes(self):
        game_state = await database_sync_to_async(GameState.objects.get)(room=self.room)
        state = BackgammonEngine.get_initial_state()
        state["phase"] = "game_over"
        state["winner"] = "white"
        state["winType"] = "single"
        game_state.state_data = state
        await database_sync_to_async(game_state.save)()

        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined

        event = await self._receive_until(comm_white, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "white")

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")

        await comm_white.disconnect()


class CreateRoomGuardTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="player", password="pass")
        self.player = Player.objects.create(user=self.user)

    def _room_with_game_over(self):
        room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="STUCK1",
            status="playing",
        )
        RoomPlayer.objects.create(room=room, player=self.player, color="white")
        state = BackgammonEngine.get_initial_state()
        state["phase"] = "game_over"
        state["winner"] = "black"
        state["winType"] = "single"
        GameState.objects.create(room=room, state_data=state)
        return room

    def test_create_room_allows_new_room_when_stale_game_over(self):
        stale = self._room_with_game_over()

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.post("/api/rooms/", {"targetPoints": 7}, format="json")

        self.assertEqual(response.status_code, 201)
        stale.refresh_from_db()
        self.assertEqual(stale.status, "completed")
        self.assertEqual(Match.objects.filter(room=stale).count(), 1)

    def test_create_room_still_rejects_active_playing_room(self):
        room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="ACTIVE",
            status="playing",
        )
        RoomPlayer.objects.create(room=room, player=self.player, color="white")
        GameState.objects.create(room=room, state_data=BackgammonEngine.get_initial_state())

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.post("/api/rooms/", {"targetPoints": 7}, format="json")

        self.assertEqual(response.status_code, 400)


class ClockHelperTests(TestCase):
    def test_parse_time_control(self):
        from game.clock import parse_time_control
        self.assertEqual(parse_time_control('fast'), (60_000, 5_000))
        self.assertEqual(parse_time_control('normal'), (120_000, 12_000))
        self.assertEqual(parse_time_control('slow'), (300_000, 12_000))
        self.assertIsNone(parse_time_control('none'))
        self.assertIsNone(parse_time_control(None))
        self.assertIsNone(parse_time_control('bogus'))

    def test_parse_time_control_accepts_legacy_ids(self):
        from game.clock import parse_time_control
        self.assertEqual(parse_time_control('2+12'), (120_000, 12_000))
        self.assertEqual(parse_time_control('1+5'), (60_000, 5_000))

    def test_active_player_is_turn_normally(self):
        from game.clock import active_player
        self.assertEqual(active_player({'phase': 'moving', 'turn': 'white'}), 'white')

    def test_active_player_responder_pays_during_doubling(self):
        from game.clock import active_player
        state = {'phase': 'doubling_offered', 'turn': 'black', 'doubleOfferedBy': 'white'}
        self.assertEqual(active_player(state), 'black')

    def test_active_player_none_when_game_over(self):
        from game.clock import active_player
        self.assertIsNone(active_player({'phase': 'game_over', 'winner': 'white'}))

    def test_active_player_none_during_opening_roll(self):
        from game.clock import active_player
        self.assertIsNone(active_player({'phase': 'opening_roll', 'turn': 'white'}))

    def test_apply_transition_charges_only_beyond_delay(self):
        from game.clock import apply_transition
        clock = {'white': 180_000, 'black': 180_000}
        # White moves in 5s, delay is 10s: nothing charged, no bonus banked.
        out = apply_transition(clock, 'white', 'black', 5_000, 10_000)
        self.assertEqual(out['white'], 180_000)
        self.assertEqual(out['black'], 180_000)  # frozen while white acted

    def test_apply_transition_charges_past_delay(self):
        from game.clock import apply_transition
        clock = {'white': 180_000, 'black': 180_000}
        # White takes 15s, delay is 10s: 5s charged from reserve.
        out = apply_transition(clock, 'white', 'black', 15_000, 10_000)
        self.assertEqual(out['white'], 175_000)

    def test_apply_transition_floors_at_zero(self):
        from game.clock import apply_transition
        clock = {'white': 2_000, 'black': 180_000}
        self.assertEqual(apply_transition(clock, 'white', 'black', 5_000, 0)['white'], 0)

    def test_apply_transition_noop_when_active_unchanged(self):
        from game.clock import apply_transition
        clock = {'white': 180_000, 'black': 180_000}
        self.assertEqual(apply_transition(clock, 'white', 'white', 5_000, 10_000), clock)

    def test_deadline_includes_delay(self):
        from game.clock import deadline_for
        state = {
            'phase': 'moving',
            'turn': 'white',
            'clock': {'white': 60_000, 'black': 60_000},
            'turnStartedAt': 1_000,
        }
        self.assertEqual(deadline_for(state, 'fast'), 1_000 + 5_000 + 60_000)

    def test_deadline_none_for_no_limit(self):
        from game.clock import deadline_for
        state = {
            'phase': 'moving',
            'turn': 'white',
            'clock': {'white': 60_000, 'black': 60_000},
            'turnStartedAt': 1_000,
        }
        self.assertIsNone(deadline_for(state, 'none'))


class CreateRoomTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='creator', password='pass')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_room_stores_time_control(self):
        resp = self.client.post(
            '/api/rooms/',
            {'targetPoints': 5, 'preferredColor': 'white', 'time': 'slow'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        room = GameRoom.objects.get(id=resp.data['id'])
        self.assertEqual(room.time_control, 'slow')
        self.assertEqual(resp.data['timeControl'], 'slow')

    def test_create_room_defaults_to_normal(self):
        resp = self.client.post(
            '/api/rooms/',
            {'targetPoints': 5, 'preferredColor': 'white'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        room = GameRoom.objects.get(id=resp.data['id'])
        self.assertEqual(room.time_control, 'normal')
