import asyncio
import uuid
from urllib.parse import urlencode

from channels.testing import WebsocketCommunicator
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework.test import APIClient

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.game_service import finalize_room
from game.models import GameRoom, GameState, GameEvent, Match, Player, RoomPlayer


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
        communicator.scope["url_route"] = {
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
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")

        await communicator.disconnect()

    async def test_black_player_connects_with_persistent_color(self):
        communicator = self._make_communicator(self.black_user)
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "black")

        await communicator.disconnect()

    async def test_reconnect_uses_same_color(self):
        comm1 = self._make_communicator(self.white_user)
        await comm1.connect()
        await comm1.receive_json_from()
        await comm1.disconnect()

        comm2 = self._make_communicator(self.white_user)
        connected, _ = await comm2.connect()
        self.assertTrue(connected)

        response = await comm2.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")

        await comm2.disconnect()

    async def test_initial_state_update_includes_player_usernames(self):
        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        response = await communicator.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["players"], {"white": "white", "black": "black"})

        await communicator.disconnect()

    async def test_player_joined_broadcast_includes_username(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect()
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()

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
        await comm_white.connect()
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        await comm_white.connect()
        await comm_white.receive_json_from()  # state_update
        await comm_white.receive_json_from()  # player_joined (own broadcast)

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        connected, _ = await communicator.connect()
        self.assertFalse(connected)

    async def test_reconnect_after_disconnect_restores_color(self):
        comm1 = self._make_communicator(self.white_user)
        await comm1.connect()
        await comm1.receive_json_from()
        await comm1.disconnect()

        comm2 = self._make_communicator(self.white_user)
        connected, _ = await comm2.connect()
        self.assertTrue(connected)

        response = await comm2.receive_json_from()
        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["playerColor"], "white")
        self.assertIsNotNone(response["payload"])

        await comm2.disconnect()

    async def test_state_update_records_event_and_broadcasts_version(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect()
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        await comm_white.connect()
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        communicator.scope["url_route"] = {
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
        await comm_white.connect()
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        await comm_white.connect()
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
        await comm_white.connect()
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        await comm_white.connect()
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect()
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
        await comm_white.connect()
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
        self.assertEqual(parse_time_control('3+10'), (180_000, 10_000))
        self.assertIsNone(parse_time_control('none'))
        self.assertIsNone(parse_time_control(None))
        self.assertIsNone(parse_time_control('bogus'))

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

    def test_apply_transition_charges_and_bonuses(self):
        from game.clock import apply_transition
        clock = {'white': 180_000, 'black': 180_000}
        out = apply_transition(clock, 'white', 'black', 5_000, 10_000)
        self.assertEqual(out['white'], 185_000)   # 180_000 - 5_000 + 10_000
        self.assertEqual(out['black'], 180_000)   # frozen while white acted

    def test_apply_transition_floors_at_zero(self):
        from game.clock import apply_transition
        clock = {'white': 2_000, 'black': 180_000}
        self.assertEqual(apply_transition(clock, 'white', 'black', 5_000, 0)['white'], 0)

    def test_apply_transition_noop_when_active_unchanged(self):
        from game.clock import apply_transition
        clock = {'white': 180_000, 'black': 180_000}
        self.assertEqual(apply_transition(clock, 'white', 'white', 5_000, 10_000), clock)
