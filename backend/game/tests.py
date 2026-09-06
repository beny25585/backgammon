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
from game.game_service import finalize_room, record_game_end
from game.models import GameRoom, GameState, GameEvent, Match, Player, RoomPlayer
from unittest.mock import patch

from .dice import DiceServiceError, fetch_dice, fetch_opening_dice, fetch_turn_dice



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

    async def _seed_state(self, **overrides):
        """Persist a full game state directly, bypassing the opening roll."""
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'clock': {'white': 120_000, 'black': 120_000},
            'turnStartedAt': int(time_module.time() * 1000),
            **overrides,
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

    async def _resolve_opening(self, comm_white, comm_black):
        """Tap through the per-player opening roll against the real dice service.

        White taps (reveals one die and hands the dice to black), then black
        taps. Returns the opening_result broadcast, white's die, and black's die.
        """
        await comm_white.send_json_to({
            "type": "state_update",
            "payload": {"action": "roll"},
        })
        event = await self._receive_until(
            comm_white,
            lambda e: (not e.get("initial"))
            and e.get("payload", {}).get("openingRoll", {}).get("white") is not None
            and e.get("payload", {}).get("openingRoll", {}).get("black") is None,
        )
        white_die = event["payload"]["openingRoll"]["white"]
        await comm_black.send_json_to({
            "type": "state_update",
            "payload": {"action": "roll"},
        })
        result = await self._receive_until(
            comm_white,
            lambda e: (not e.get("initial"))
            and e.get("payload", {}).get("phase") == "opening_result",
        )
        return {
            "event": result,
            "white_die": white_die,
            "black_die": result["payload"]["openingRoll"]["black"],
        }

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

    async def test_initial_state_update_includes_persisted_match_score(self):
        await database_sync_to_async(GameRoom.objects.filter(pk=self.room.pk).update)(
            white_score=2,
            black_score=1,
        )
        communicator = self._make_communicator(self.white_user)
        connected, _ = await communicator.connect(timeout=10)
        self.assertTrue(connected)

        response = await communicator.receive_json_from()

        self.assertEqual(response["type"], "state_update")
        self.assertEqual(response["matchScore"], {"white": 2, "black": 1})
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

    async def test_intent_records_event_and_broadcasts_version(self):
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'version': 0,
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            "type": "state_update",
            "payload": {"action": "move", "from": 12, "to": 9},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "state_update" and not e.get("initial"))
        self.assertEqual(event["type"], "state_update")
        self.assertEqual(event["payload"]["version"], 1)
        self.assertEqual(event["payload"]["phase"], "moving")
        self.assertEqual(event["payload"]["remaining"], [5])

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

    async def test_legacy_full_state_payload_is_rejected(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()  # state_update (initial)
        await comm_white.receive_json_from()  # player_joined

        await comm_white.send_json_to({
            "type": "state_update",
            "payload": {"state": {"phase": "moving", "turn": "white"}, "action": "move"},
        })
        event = await self._receive_until(comm_white, lambda e: e.get("type") == "error")
        self.assertEqual(event["type"], "error")
        self.assertIn("intents only", event["message"])

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 0)

        await comm_white.disconnect()


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

    async def test_clock_not_started_during_opening_roll(self):
        # Both players tap their opening die; during opening_result nobody is
        # on the clock: reserves are seeded but the clock is not started
        # (turnStartedAt stays null).
        comm_white, comm_black = await self._connect_both()
        result = await self._resolve_opening(comm_white, comm_black)
        event = result['event']
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertIsNone(event['payload'].get('turnStartedAt'))
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_clock_starts_when_opening_dice_become_playable(self):
        GameConsumer.OPENING_RESULT_DELAY = 0.1
        try:
            comm_white, comm_black = await self._connect_both()
            # Opening roll: no active player, clock not started.
            result = await self._resolve_opening(comm_white, comm_black)
            event = result['event']
            self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
            self.assertIsNone(event['payload'].get('turnStartedAt'))
            winner = event['payload']['turn']  # whoever rolled higher

            # Once the result banner ends, the opening dice become playable and
            # only then does the winner's clock start.
            event = await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('phase') == 'moving')
            self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
            self.assertIsInstance(event['payload'].get('turnStartedAt'), int)
            self.assertEqual(event['payload']['turn'], winner)
        finally:
            GameConsumer.OPENING_RESULT_DELAY = 3.0
            await comm_white.disconnect()
            await comm_black.disconnect()

    async def test_clock_is_always_server_computed(self):
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 120_000, 'black': 120_000},
            'turnStartedAt': int(time_module.time() * 1000),
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        # Intents carry no clock; the server recomputes it from its own state.
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'action': 'move', 'from': 12, 'to': 9},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        self.assertEqual(event['payload']['clock'], {'white': 120_000, 'black': 120_000})
        self.assertEqual(event['payload']['turnStartedAt'], stored['turnStartedAt'])
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_turn_change_charges_only_beyond_delay(self):
        stored = {
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 120_000, 'black': 120_000},
            # White has been thinking 15s; delay is 12s, so 3s should be charged.
            'turnStartedAt': int(time_module.time() * 1000) - 15_000,
        }
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        # white ends the turn -> turn goes to black
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'action': 'end_turn'},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'state_update' and not e.get('initial'))
        clock = event['payload']['clock']
        self.assertEqual(clock['black'], 120_000)  # frozen while white acted
        self.assertTrue(116_000 <= clock['white'] <= 117_000)  # 120s - (15s - 12s)
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_timeout_when_remaining_time_already_expired(self):
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 0, 'black': 180_000},
            'turnStartedAt': int(time_module.time() * 1000) - 5_000,
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'action': 'move', 'from': 12, 'to': 9},
        })
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'game_ended')
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_deadline_task_forfeits_when_player_never_acts(self):
        stored = {
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 100, 'black': 120_000},
            # White's deadline is 12s delay + 100ms reserve after turnStartedAt;
            # put turnStartedAt in the past so the deadline is effectively now.
            'turnStartedAt': int(time_module.time() * 1000) - 12_100,
        }
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        # White never acts; connect() arms the deadline from the stored state.
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        event = await self._receive_until(comm_white, lambda e: e.get('type') == 'game_ended')
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        await comm_white.disconnect()

    async def test_wrong_player_cannot_roll_or_move(self):
        await self._seed_state(phase='rolling', turn='white', dice=[], remaining=[])
        comm_white, comm_black = await self._connect_both()

        # Black (not the current player) tries to roll and to move.
        await comm_black.send_json_to({'type': 'state_update', 'payload': {'action': 'roll'}})
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'error')
        self.assertEqual(event['type'], 'error')
        self.assertIn('Cannot roll now', event['message'])

        await comm_black.send_json_to({'type': 'state_update', 'payload': {'action': 'move', 'from': 11, 'to': 6}})
        event = await self._receive_until(comm_black, lambda e: e.get('type') == 'error')
        self.assertEqual(event['type'], 'error')
        self.assertIn('Not your turn', event['message'])

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 0)

    async def test_roll_intent_rolls_from_real_dice_service(self):
        await self._seed_state(phase='rolling', turn='white', dice=[], remaining=[])
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'roll'}})
        event = await self._receive_until(comm_white, lambda e: e.get('type') == 'state_update' and e.get('payload', {}).get('phase') == 'moving')
        dice = event['payload']['dice']
        remaining = event['payload']['remaining']
        self.assertEqual(len(dice), 2)
        self.assertTrue(all(1 <= d <= 6 for d in dice))
        self.assertEqual(remaining[:2], dice)
        if dice[0] == dice[1]:
            self.assertEqual(len(remaining), 4)  # doubles
        else:
            self.assertEqual(len(remaining), 2)
        self.assertEqual(event['payload']['version'], 1)

    async def test_roll_intent_recovers_discarded_opening_dice_without_rerolling(self):
        await self._seed_state(
            phase='rolling',
            turn='white',
            dice=[],
            remaining=[],
            openingRoll={'white': 5, 'black': 2},
            lastMove=None,
            moveHistory=None,
            message='white goes first',
        )
        comm_white, comm_black = await self._connect_both()

        with patch('game.consumers.fetch_turn_dice') as fetch_turn:
            await comm_white.send_json_to({
                'type': 'state_update',
                'payload': {'action': 'roll'},
            })
            event = await self._receive_until(
                comm_white,
                lambda e: e.get('payload', {}).get('phase') == 'moving',
            )

        fetch_turn.assert_not_called()
        self.assertEqual(event['payload']['turn'], 'white')
        self.assertEqual(event['payload']['dice'], [5, 2])
        self.assertEqual(event['payload']['remaining'], [5, 2])
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_illegal_move_rejected_and_state_unchanged(self):
        await self._seed_state(phase='moving', turn='white', dice=[3, 5], remaining=[3, 5])
        comm_white, comm_black = await self._connect_both()

        # from=0 is black's point; white cannot move from it.
        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'move', 'from': 0, 'to': 5}})
        event = await self._receive_until(comm_white, lambda e: e.get('type') == 'error')
        self.assertEqual(event['type'], 'error')
        self.assertIn('Invalid move', event['message'])

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 0)

    async def test_move_decrements_remaining_and_end_turn_swaps(self):
        await self._seed_state(phase='moving', turn='white', dice=[3, 5], remaining=[3, 5])
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'move', 'from': 12, 'to': 9}})
        event = await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('remaining') == [5])
        self.assertEqual(event['payload']['remaining'], [5])
        self.assertEqual(event['payload']['turn'], 'white')
        self.assertEqual(event['payload']['points'][12], 4)
        self.assertEqual(event['payload']['points'][9], 1)

        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'end_turn'}})
        event = await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('phase') == 'rolling' and e.get('payload', {}).get('turn') == 'black')
        self.assertEqual(event['payload']['dice'], [])
        self.assertEqual(event['payload']['remaining'], [])
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_undo_restores_state(self):
        await self._seed_state(phase='moving', turn='white', dice=[3, 5], remaining=[3, 5])
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'move', 'from': 12, 'to': 9}})
        await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('remaining') == [5])

        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'undo'}})
        event = await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('remaining') == [3, 5])
        self.assertEqual(event['payload']['points'][12], 5)
        self.assertEqual(event['payload']['points'][9], 0)
        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_opening_resolves_once_and_reconnect_does_not_reroll(self):
        comm_white, comm_black = await self._connect_both()
        await self._resolve_opening(comm_white, comm_black)
        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 2)
        await comm_white.disconnect()
        await comm_black.disconnect()

        # Reconnect: phase is opening_result, so the opening must NOT re-roll.
        comm2 = self._make_communicator(self.white_user)
        await comm2.connect(timeout=10)
        await comm2.receive_json_from()  # state_update (initial)
        event = await comm2.receive_json_from()  # player_joined (own)
        self.assertEqual(event['type'], 'player_joined')

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 2)
        await comm2.disconnect()

    async def test_opening_result_transitions_to_first_move_after_delay(self):
        GameConsumer.OPENING_RESULT_DELAY = 0.1
        try:
            comm_white, comm_black = await self._connect_both()
            result = await self._resolve_opening(comm_white, comm_black)
            winner = result['event']['payload']['turn']
            opening_dice = [result['white_die'], result['black_die']]
            event = await self._receive_until(comm_white, lambda e: e.get('payload', {}).get('phase') == 'moving')
            self.assertEqual(event['payload']['phase'], 'moving')
            self.assertEqual(event['payload']['dice'], opening_dice)
            self.assertEqual(event['payload']['remaining'], opening_dice)
            self.assertEqual(event['payload']['turn'], winner)
        finally:
            GameConsumer.OPENING_RESULT_DELAY = 3.0
            await comm_white.disconnect()
            await comm_black.disconnect()

    async def test_opening_roll_waits_for_each_player_to_tap(self):
        comm_white, comm_black = await self._connect_both()

        # White taps first: only white's die is revealed from the real dice
        # service and the opening is still not resolved.
        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'roll'}})
        event = await self._receive_until(
            comm_white,
            lambda e: (not e.get('initial')) and e.get('payload', {}).get('openingRoll', {}).get('white') is not None,
        )
        white_die = event['payload']['openingRoll']['white']
        self.assertTrue(1 <= white_die <= 6)
        self.assertEqual(event['payload']['phase'], 'opening_roll')
        self.assertEqual(event['payload']['openingRoll'], {'white': white_die, 'black': None})
        self.assertEqual(event['payload']['turn'], 'black')

        # White cannot roll twice; the turn now belongs to black.
        await comm_white.send_json_to({'type': 'state_update', 'payload': {'action': 'roll'}})
        event = await self._receive_until(comm_white, lambda e: e.get('type') == 'error')
        self.assertIn('Not your turn to roll', event['message'])
        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 1)

        # Black taps: the pair's second die is revealed, opening resolves.
        await comm_black.send_json_to({'type': 'state_update', 'payload': {'action': 'roll'}})
        event = await self._receive_until(
            comm_black,
            lambda e: (not e.get('initial')) and e.get('payload', {}).get('phase') == 'opening_result',
        )
        self.assertEqual(event['payload']['phase'], 'opening_result')
        self.assertEqual(event['payload']['openingRoll']['white'], white_die)
        self.assertTrue(1 <= event['payload']['openingRoll']['black'] <= 6)
        self.assertIn(event['payload']['turn'], ('white', 'black'))
        await comm_white.disconnect()
        await comm_black.disconnect()


class FinalizeRoomTests(TestCase):
    def setUp(self):
        self.white_player = Player.objects.create(user=User.objects.create_user(username="w1"))
        self.black_player = Player.objects.create(user=User.objects.create_user(username="b1"))
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="FINAL1",
            status="playing",
        )
        RoomPlayer.objects.create(room=self.room, player=self.white_player, color="white")
        RoomPlayer.objects.create(room=self.room, player=self.black_player, color="black")

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

    def test_finalize_room_links_room_players_to_match(self):
        match = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertEqual(match.white_player, self.white_player)
        self.assertEqual(match.black_player, self.black_player)

    def test_finalize_room_records_metadata_fields(self):
        state = self._state(
            cube=2,
            winType='gammon',
            openingRoll={'white': 4, 'black': 3},
            clock={'white': 60000, 'black': 120000},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=1,
            event_type='roll',
            payload={'dice': [5, 2], 'turn': 'white'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=2,
            event_type='move',
            payload={'lastMove': [{'from': 5, 'to': 2}], 'turn': 'white'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=3,
            event_type='double',
            payload={'phase': 'doubling_offered', 'cube': 1, 'doubleOfferedBy': 'white'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=4,
            event_type='double_response',
            payload={'phase': 'rolling', 'cube': 2, 'doubleOfferedBy': None},
        )

        match = finalize_room(self.room, state, 'white', 'gammon', 'bear_off')

        self.assertEqual(match.end_reason, 'bear_off')
        self.assertEqual(match.first_player, 'white')
        self.assertEqual(match.opening_roll, {'white': 4, 'black': 3})
        self.assertEqual(match.final_cube, 2)
        self.assertEqual(match.doubles_offered, 1)
        self.assertEqual(match.doubles_accepted, 1)
        self.assertIsNotNone(match.duration_seconds)
        self.assertEqual(match.clock_remaining, {'white': 60000, 'black': 120000})

    def test_finalize_room_enriches_game_entry_with_board_stats(self):
        state = self._state(
            winner='black',
            points=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            bar={'white': 2, 'black': 0},
            home={'white': 13, 'black': 15},
        )

        match = finalize_room(self.room, state, 'black', 'single', 'bear_off')

        game = match.games[0]
        self.assertEqual(game['pips_remaining'], 50)
        self.assertEqual(game['checkers_on_bar'], 2)
        self.assertEqual(game['final_cube'], 1)

    def test_finalize_room_counts_hits_from_events(self):
        GameEvent.objects.create(
            room=self.room,
            sequence=1,
            event_type='move',
            payload={
                'points': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                'bar': {'white': 0, 'black': 0},
                'lastMove': [{'from': 12, 'to': 7}],
                'turn': 'white',
            },
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=2,
            event_type='move',
            payload={
                'points': [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                'bar': {'white': 0, 'black': 1},
                'lastMove': [{'from': 5, 'to': 2}],
                'turn': 'white',
            },
        )

        match = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertEqual(match.hits, 1)

    def test_finalize_room_builds_transcript_from_events(self):
        GameEvent.objects.create(
            room=self.room,
            sequence=1,
            event_type='roll',
            payload={'dice': [5, 2], 'turn': 'white'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=2,
            event_type='move',
            payload={'lastMove': [{'from': 5, 'to': 2}], 'turn': 'white'},
        )

        match = finalize_room(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertEqual(len(match.games[0]['transcript']), 1)
        self.assertEqual(match.games[0]['transcript'][0]['turn'], 'white')
        self.assertEqual(match.games[0]['transcript'][0]['roll'], [5, 2])

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


class MatchContinuationTests(TestCase):
    """record_game_end keeps a room open across games until target points."""

    def setUp(self):
        self.white_player = Player.objects.create(user=User.objects.create_user(username="wc"))
        self.black_player = Player.objects.create(user=User.objects.create_user(username="bc"))
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(),
            code="MATCH1",
            status="playing",
            target_points=5,
        )
        RoomPlayer.objects.create(room=self.room, player=self.white_player, color="white")
        RoomPlayer.objects.create(room=self.room, player=self.black_player, color="black")

    def _state(self, **overrides):
        state = BackgammonEngine.get_initial_state()
        state.update({
            'winner': 'white',
            'winType': 'single',
            'cube': 1,
            'moveHistory': [
                {'player': 'white', 'dice': [3, 2], 'from': 5, 'to': 2},
            ],
            **overrides,
        })
        return state

    def test_record_game_end_keeps_room_open_below_target(self):
        result = record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertEqual(result['match_over'], False)
        self.assertEqual(result['points'], 1)
        self.assertEqual(result['white_score'], 1)
        self.assertEqual(result['target_points'], 5)
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(self.room.white_score, 1)
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)

    def test_record_game_end_accumulates_games_in_room_state(self):
        record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')
        record_game_end(self.room, self._state(winner='black'), 'black', 'single', 'bear_off')

        self.room.refresh_from_db()
        games = self.room.state['match']['games']
        self.assertEqual(len(games), 2)
        self.assertEqual(games[0]['winner'], 'white')
        self.assertEqual(games[1]['winner'], 'black')
        self.assertEqual(games[0]['points_awarded'], 1)
        self.assertEqual(self.room.white_score, 1)
        self.assertEqual(self.room.black_score, 1)

    def test_record_game_end_closes_room_when_target_reached(self):
        self.room.white_score = 4
        self.room.save()

        result = record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')

        self.assertEqual(result['match_over'], True)
        self.assertIsNotNone(result['match'])
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(self.room.white_score, 5)
        match = Match.objects.get(room=self.room)
        self.assertEqual(match.winner, 'white')
        self.assertEqual(match.white_score, 5)
        self.assertEqual(len(match.games), 1)

    def test_record_game_end_links_room_players_to_match(self):
        self.room.white_score = 4
        self.room.save()

        result = record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')

        match = result['match']
        self.assertIsNotNone(match)
        self.assertEqual(match.white_player, self.white_player)
        self.assertEqual(match.black_player, self.black_player)

    def test_record_game_end_records_metadata_fields(self):
        self.room.white_score = 4
        self.room.save()

        result = record_game_end(
            self.room,
            self._state(cube=4, openingRoll={'white': 2, 'black': 1}),
            'white',
            'single',
            'give_up',
        )

        match = result['match']
        self.assertEqual(match.end_reason, 'give_up')
        self.assertEqual(match.first_player, 'white')
        self.assertEqual(match.opening_roll, {'white': 2, 'black': 1})
        self.assertEqual(match.final_cube, 4)

    def test_record_game_end_games_include_transcript_and_hits(self):
        self.room.white_score = 4
        self.room.save()
        GameEvent.objects.create(
            room=self.room,
            sequence=1,
            event_type='roll',
            payload={'dice': [4, 3], 'turn': 'black'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=2,
            event_type='move',
            payload={
                'points': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                'bar': {'white': 0, 'black': 0},
                'lastMove': [{'from': 5, 'to': 2}],
                'turn': 'black',
            },
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=3,
            event_type='move',
            payload={
                'points': [0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                'bar': {'white': 1, 'black': 0},
                'lastMove': [{'from': 2, 'to': 5}],
                'turn': 'black',
            },
        )

        result = record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')

        match = result['match']
        self.assertEqual(match.hits, 1)
        self.assertEqual(len(match.games), 1)
        self.assertEqual(match.games[0]['transcript'][0]['turn'], 'black')
        self.assertEqual(match.games[0]['transcript'][0]['roll'], [4, 3])

    def test_record_game_end_applies_multiplier_to_points(self):
        result = record_game_end(
            self.room, self._state(winType='gammon', cube=2), 'white', 'gammon', 'bear_off'
        )

        self.assertEqual(result['points'], 4)
        self.assertEqual(result['white_score'], 4)
        self.room.refresh_from_db()
        self.assertEqual(self.room.state['match']['games'][0]['points_awarded'], 4)

    def test_record_game_end_ignores_finished_room(self):
        self.room.status = 'completed'
        self.room.save()

        result = record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')
        self.assertIsNone(result)
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)

    def test_record_game_end_saves_transcript_from_history(self):
        GameEvent.objects.create(
            room=self.room,
            sequence=1,
            event_type='roll',
            payload={'dice': [3, 2], 'turn': 'white'},
        )
        GameEvent.objects.create(
            room=self.room,
            sequence=2,
            event_type='move',
            payload={'lastMove': [{'from': 5, 'to': 2}], 'turn': 'white'},
        )
        record_game_end(self.room, self._state(), 'white', 'single', 'bear_off')

        self.room.refresh_from_db()
        games = self.room.state['match']['games']
        self.assertEqual(games[0]['transcript'][0]['turn'], 'white')
        self.assertEqual(games[0]['transcript'][0]['roll'], [3, 2])
        self.assertEqual(games[0]['transcript'][0]['moves'], [{'from': 5, 'to': 2}])


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

    async def _set_target(self, points):
        self.room.target_points = points
        await database_sync_to_async(self.room.save)()

    async def _connect_both(self):
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()
        await comm_black.receive_json_from()
        while True:
            event = await comm_white.receive_json_from()
            if event.get('type') == 'player_joined' and event.get('payload', {}).get('username') == 'black':
                break
        return comm_white, comm_black

    async def test_game_ended_below_target_keeps_room_open_for_next_game(self):
        comm_white, comm_black = await self._connect_both()

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
        self.assertEqual(event["payload"]["targetPoints"], 7)
        self.assertEqual(event["payload"]["matchOver"], False)
        self.assertEqual(event["payload"]["nextGame"], True)
        self.assertIn("nextGameIn", event["payload"])
        self.assertGreater(event["payload"]["nextGameIn"], 0)
        self.assertLessEqual(event["payload"]["nextGameIn"], int(GameConsumer.NEXT_GAME_DELAY))

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "playing")
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 0)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_auto_starts_next_game_after_countdown(self):
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        with patch.object(GameConsumer, "NEXT_GAME_DELAY", 0.2):
            await comm_white.send_json_to({
                "type": "game_ended",
                "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
            })
            event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")

            fresh = await self._receive_until(
                comm_black,
                lambda e: e.get("type") == "state_update"
                and not e.get("initial")
                and e.get("payload", {}).get("phase") == "opening_roll"
                and e.get("payload", {}).get("version", 0) > event["payload"].get("version", 0),
            )

        initial = BackgammonEngine.get_initial_state()
        self.assertEqual(fresh["payload"]["points"], initial["points"])
        self.assertEqual(fresh["payload"]["openingRoll"], {"white": None, "black": None})
        self.assertEqual(fresh["payload"]["turn"], "white")
        self.assertIsNone(fresh["payload"].get("winner"))
        # Clocks reset for the new game.
        self.assertEqual(fresh["payload"]["clock"], {"white": 120_000, "black": 120_000})

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "playing")
        self.assertEqual(self.room.white_score, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_reconnect_mid_match_replays_result_with_remaining_countdown(self):
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({
            "type": "game_ended",
            "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
        })
        await self._receive_until(comm_white, lambda e: e.get("type") == "game_ended")

        await comm_white.disconnect()
        await comm_black.disconnect()

        comm_re = self._make_communicator(self.white_user)
        await comm_re.connect(timeout=10)
        await comm_re.receive_json_from()  # state_update (initial)

        event = await self._receive_until(comm_re, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "white")
        self.assertIn("nextGameIn", event["payload"])
        self.assertGreater(event["payload"]["nextGameIn"], 0)
        self.assertLessEqual(event["payload"]["nextGameIn"], int(GameConsumer.NEXT_GAME_DELAY))

        await comm_re.disconnect()

    async def test_game_ended_message_is_idempotent(self):
        await self._set_target(1)
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
        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.white_score, 1)

        await comm_white.disconnect()

    async def test_give_up_finalizes_room_and_broadcasts(self):
        await self._set_target(1)
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
        self.assertEqual(event["payload"]["matchOver"], True)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_give_up_awards_one_point_and_keeps_match_open(self):
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({"type": "give_up", "payload": {}})

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["reason"], "give_up")
        self.assertEqual(event["payload"]["points"], 1)
        self.assertEqual(event["payload"]["blackScore"], 1)
        self.assertEqual(event["payload"]["whiteScore"], 0)
        self.assertEqual(event["payload"]["matchOver"], False)
        self.assertEqual(event["payload"]["nextGame"], True)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "playing")
        self.assertEqual(self.room.black_score, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_leave_forfeits_and_closes_room(self):
        # Unlike give_up (one game), leaving abandons the whole match even
        # mid-match, so the room closes and the opponent is declared winner.
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({"type": "leave", "payload": {}})

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["loser"], "white")
        self.assertEqual(event["payload"]["reason"], "leave")
        self.assertEqual(event["payload"]["matchOver"], True)
        self.assertEqual(event["payload"]["nextGame"], False)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")
        self.assertEqual(self.room.black_score, 1)
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)
        match = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).first()
        )()
        self.assertEqual(match.winner, "black")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_reconnect_to_closed_leave_room_replays_result(self):
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({"type": "leave", "payload": {}})
        await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        await comm_white.disconnect()
        await comm_black.disconnect()

        # The winner returns to a completed room: the recorded result is
        # replayed with the original reason and the room stays closed.
        comm_re = self._make_communicator(self.black_user)
        await comm_re.connect(timeout=10)
        await comm_re.receive_json_from()  # state_update (initial)

        event = await self._receive_until(comm_re, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["reason"], "leave")
        self.assertEqual(event["payload"]["matchOver"], True)
        self.assertEqual(event["payload"]["nextGame"], False)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

        await comm_re.disconnect()

    async def test_leave_rejected_when_no_active_game(self):
        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({"type": "leave", "payload": {}})
        await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")

        # A second leave on the now-closed room is rejected.
        await comm_white.send_json_to({"type": "leave", "payload": {}})
        event = await self._receive_until(comm_white, lambda e: e.get("type") == "error")
        self.assertIn("No active game", event["message"])

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_state_update_with_game_over_finalizes_room(self):
        await self._set_target(1)
        comm_white = self._make_communicator(self.white_user)
        await comm_white.connect(timeout=10)
        await comm_white.receive_json_from()
        await comm_white.receive_json_from()

        comm_black = self._make_communicator(self.black_user)
        await comm_black.connect(timeout=10)
        await comm_black.receive_json_from()
        await comm_black.receive_json_from()
        await comm_white.receive_json_from()

        # Full-state intents are rejected, so reach game_over through a real
        # winning move instead: black bears off its last checker.
        state = BackgammonEngine.get_initial_state()
        state["points"] = [0] * 24
        state["points"][18] = -1
        state["home"] = {"white": 0, "black": 14}
        state["bar"] = {"white": 0, "black": 0}
        state["turn"] = "black"
        state["phase"] = "moving"
        state["dice"] = [5, 1]
        state["remaining"] = [5, 1]
        gs = await get_game_state(self.room)
        gs.state_data = state
        await save_game_state(gs)

        await comm_black.send_json_to({
            "type": "state_update",
            "payload": {"action": "move", "from": 18, "to": 23},
        })
        await self._receive_until(comm_black, lambda e: e.get("payload", {}).get("remaining") == [1])

        await comm_black.send_json_to({
            "type": "state_update",
            "payload": {"action": "move", "from": 23, "to": "off"},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "black")
        self.assertEqual(event["payload"]["reason"], "move")
        self.assertEqual(event["payload"]["matchOver"], True)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_match_reaching_target_closes_room(self):
        await self._set_target(1)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({
            "type": "game_ended",
            "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
        })

        event = await self._receive_until(comm_white, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event["payload"]["winner"], "white")
        self.assertEqual(event["payload"]["matchOver"], True)
        self.assertEqual(event["payload"]["nextGame"], False)
        self.assertEqual(event["payload"]["whiteScore"], 1)
        self.assertEqual(event["payload"]["targetPoints"], 1)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "completed")
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_next_game_intent_starts_fresh_opening_roll(self):
        await self._set_target(5)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({
            "type": "game_ended",
            "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
        })
        await self._receive_until(comm_white, lambda e: e.get("type") == "game_ended")

        await comm_white.send_json_to({"type": "state_update", "payload": {"action": "next_game"}})
        event = await self._receive_until(
            comm_white,
            lambda e: e.get("type") == "state_update"
            and not e.get("initial")
            and e.get("payload", {}).get("phase") == "opening_roll"
            and e.get("payload", {}).get("turn") == "white",
        )
        initial = BackgammonEngine.get_initial_state()
        self.assertEqual(event["payload"]["points"], initial["points"])
        self.assertEqual(event["payload"]["openingRoll"], {"white": None, "black": None})
        self.assertEqual(event["payload"]["home"], {"white": 0, "black": 0})
        self.assertEqual(event["payload"]["bar"], {"white": 0, "black": 0})
        self.assertIsNone(event["payload"].get("winner"))
        self.assertIsNone(event["payload"].get("openingDice"))

        # The fresh game's opening roll works against the real dice service.
        await comm_white.send_json_to({"type": "state_update", "payload": {"action": "roll"}})
        event = await self._receive_until(
            comm_white,
            lambda e: (not e.get("initial"))
            and e.get("payload", {}).get("openingRoll", {}).get("white") is not None,
        )
        self.assertTrue(1 <= event["payload"]["openingRoll"]["white"] <= 6)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, "playing")
        self.assertEqual(self.room.white_score, 1)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_next_game_rejected_when_game_not_over(self):
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({"type": "state_update", "payload": {"action": "next_game"}})
        event = await self._receive_until(comm_white, lambda e: e.get("type") == "error")
        self.assertIn("Cannot start next game now", event["message"])

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.last_sequence, 0)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_next_game_rejected_when_match_finished(self):
        await self._set_target(1)
        comm_white, comm_black = await self._connect_both()

        await comm_white.send_json_to({
            "type": "game_ended",
            "payload": {"winner": "white", "winType": "single", "reason": "bear_off", "cube": 1},
        })
        await self._receive_until(comm_white, lambda e: e.get("type") == "game_ended")

        await comm_white.send_json_to({"type": "state_update", "payload": {"action": "next_game"}})
        event = await self._receive_until(comm_white, lambda e: e.get("type") == "error")
        self.assertIn("No active game", event["message"])

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_timeout_mid_match_keeps_room_open(self):
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 0, 'black': 180_000},
            'turnStartedAt': int(time_module.time() * 1000) - 5_000,
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'action': 'move', 'from': 12, 'to': 9},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        self.assertEqual(event['payload']['matchOver'], False)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(self.room.black_score, 1)
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 0)

        await comm_white.disconnect()
        await comm_black.disconnect()

    async def test_timeout_reaching_target_closes_room(self):
        await self._set_target(1)
        stored = BackgammonEngine.get_initial_state()
        stored.update({
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
            'clock': {'white': 0, 'black': 180_000},
            'turnStartedAt': int(time_module.time() * 1000) - 5_000,
        })
        gs = await get_game_state(self.room)
        gs.state_data = stored
        await save_game_state(gs)

        comm_white, comm_black = await self._connect_both()
        await comm_white.send_json_to({
            'type': 'state_update',
            'payload': {'action': 'move', 'from': 12, 'to': 9},
        })

        event = await self._receive_until(comm_black, lambda e: e.get("type") == "game_ended")
        self.assertEqual(event['payload']['winner'], 'black')
        self.assertEqual(event['payload']['reason'], 'time')
        self.assertEqual(event['payload']['matchOver'], True)

        await database_sync_to_async(self.room.refresh_from_db)()
        self.assertEqual(self.room.status, 'completed')
        match_count = await database_sync_to_async(
            lambda: Match.objects.filter(room=self.room).count()
        )()
        self.assertEqual(match_count, 1)

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

        # game_ended is broadcast during connect, before player_joined lands, so
        # skip the initial state_update / player_joined messages explicitly.
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

    def test_active_player_is_turn_while_waiting_to_roll(self):
        from game.clock import active_player
        self.assertEqual(active_player({'phase': 'rolling', 'turn': 'white', 'remaining': []}), 'white')

    def test_active_player_is_turn_after_dice_are_rolled(self):
        from game.clock import active_player
        self.assertEqual(active_player({'phase': 'moving', 'turn': 'white', 'remaining': [3, 5]}), 'white')

    def test_clock_starts_after_double_accept_while_waiting_to_roll(self):
        from game.clock import compute_clock
        stored = {
            'phase': 'doubling_offered',
            'turn': 'white',
            'doubleOfferedBy': 'white',
            'clock': {'white': 120_000, 'black': 120_000},
            'turnStartedAt': 1_000,
        }
        incoming = {
            'phase': 'rolling',
            'turn': 'white',
            'dice': [],
            'remaining': [],
            'doubleOfferedBy': None,
        }

        clock, turn_started_at, active, timed_out, deadline = compute_clock(
            stored, incoming, 9_000, 'normal')

        self.assertEqual(clock, {'white': 120_000, 'black': 120_000})
        self.assertEqual(turn_started_at, 9_000)
        self.assertEqual(active, 'white')
        self.assertFalse(timed_out)
        self.assertEqual(deadline, 9_000 + 12_000 + 120_000)

    def test_clock_starts_when_dice_are_rolled_and_player_can_move(self):
        from game.clock import compute_clock
        stored = {
            'phase': 'rolling',
            'turn': 'white',
            'clock': {'white': 120_000, 'black': 120_000},
            'turnStartedAt': None,
        }
        incoming = {
            'phase': 'moving',
            'turn': 'white',
            'dice': [3, 5],
            'remaining': [3, 5],
        }

        clock, turn_started_at, active, timed_out, deadline = compute_clock(
            stored, incoming, 9_000, 'normal')

        self.assertEqual(clock, {'white': 120_000, 'black': 120_000})
        self.assertEqual(turn_started_at, 9_000)
        self.assertEqual(active, 'white')
        self.assertFalse(timed_out)
        self.assertEqual(deadline, 9_000 + 12_000 + 120_000)

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


class DiceClientTests(TransactionTestCase):
    """Step 2: HTTP client for the Elixir dice service — hits the real API."""

    def _serve(self, body, status=200):
        """Start a real HTTP server returning `body`; return its URL."""
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                raw = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # addCleanup runs LIFO: shut the server down before joining its thread.
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    async def test_fetch_dice_normal_returns_valid_dice(self):
        a, b = await fetch_dice("normal")
        self.assertTrue(1 <= a <= 6 and 1 <= b <= 6)

    async def test_fetch_opening_dice_returns_distinct_dice(self):
        a, b = await fetch_opening_dice()
        self.assertTrue(1 <= a <= 6 and 1 <= b <= 6)
        self.assertNotEqual(a, b)

    async def test_fetch_turn_dice_returns_valid_dice(self):
        a, b = await fetch_turn_dice()
        self.assertTrue(1 <= a <= 6 and 1 <= b <= 6)

    async def test_fetch_dice_rejects_unknown_type(self):
        with self.assertRaises(ValueError):
            await fetch_dice("weird")

    async def test_fetch_dice_raises_on_non_200(self):
        with patch("game.dice.DICE_SERVICE_URL", self._serve('{"error":"down"}', status=503)):
            with self.assertRaises(DiceServiceError):
                await fetch_dice("normal")

    async def test_fetch_dice_raises_on_malformed_payload(self):
        with patch("game.dice.DICE_SERVICE_URL", self._serve('{"dice":"nope"}')):
            with self.assertRaises(DiceServiceError):
                await fetch_dice("normal")

    async def test_fetch_dice_raises_on_missing_key(self):
        with patch("game.dice.DICE_SERVICE_URL", self._serve('{"roll":[3,5]}')):
            with self.assertRaises(DiceServiceError):
                await fetch_dice("normal")

    async def test_fetch_dice_raises_on_out_of_range(self):
        with patch("game.dice.DICE_SERVICE_URL", self._serve('{"dice":[0,7]}')):
            with self.assertRaises(DiceServiceError):
                await fetch_dice("normal")

    async def test_fetch_opening_dice_raises_on_doubles(self):
        with patch("game.dice.DICE_SERVICE_URL", self._serve('{"dice":[3,3]}')):
            with self.assertRaises(DiceServiceError):
                await fetch_opening_dice()

    async def test_fetch_dice_raises_when_service_unreachable(self):
        with patch("game.dice.DICE_SERVICE_URL", "http://127.0.0.1:1"):
            with self.assertRaises(DiceServiceError):
                await fetch_dice("normal")


class BackgammonEngineTests(TestCase):
    """Step 3: server-side dice injection into the engine (game/engine.py)."""

    def _engine(self, state=None):
        return BackgammonEngine(state)

    def test_offer_double_is_rejected_when_the_match_disables_doubling(self):
        state = BackgammonEngine.get_initial_state()
        state['phase'] = 'rolling'
        state['doublingEnabled'] = False
        engine = self._engine(state)

        result = engine.offer_double('white')

        self.assertFalse(result['success'])
        self.assertEqual(result['message'], 'Doubling is disabled for this match')
        self.assertEqual(engine.state['cube'], 1)
        self.assertIsNone(engine.state['doubleOfferedBy'])

    def test_roll_dice_uses_injected_values(self):
        engine = self._engine()
        engine.state["phase"] = "rolling"
        result = engine.roll_dice(dice=(3, 5))
        self.assertEqual(result["dice"], [5, 3])
        self.assertEqual(engine.state["dice"], [5, 3])
        self.assertEqual(engine.state["remaining"], [5, 3])
        self.assertEqual(engine.state["phase"], "moving")
        self.assertEqual(engine.state["lastMove"], [])
        self.assertEqual(engine.state["moveHistory"], [])
        self.assertEqual(engine.state["version"], 1)

    def test_roll_dice_injected_double_creates_four_uses(self):
        engine = self._engine()
        engine.state["phase"] = "rolling"
        result = engine.roll_dice(dice=(4, 4))
        self.assertEqual(result["dice"], [4, 4])
        self.assertEqual(engine.state["dice"], [4, 4])
        self.assertEqual(engine.state["remaining"], [4, 4, 4, 4])

    def test_roll_dice_rolls_locally_when_no_dice_given(self):
        engine = self._engine()
        engine.state["phase"] = "rolling"
        with patch("game.engine.BackgammonEngine._roll_dice", return_value=[2, 4]):
            result = engine.roll_dice()
        self.assertEqual(result["dice"], [4, 2])
        self.assertEqual(engine.state["remaining"], [4, 2])

    def test_roll_dice_rejects_outside_rolling_phase(self):
        engine = self._engine()
        engine.state["phase"] = "moving"
        result = engine.roll_dice(dice=(1, 2))
        self.assertFalse(result["success"])
        self.assertEqual(engine.state["phase"], "moving")

    def test_reorder_dice_changes_which_die_is_used_for_same_destination(self):
        state = BackgammonEngine.get_initial_state()
        state["points"] = [0] * 24
        state["points"][5] = 1
        state["points"][3] = 1
        state["turn"] = "white"
        state["phase"] = "moving"
        state["dice"] = [5, 3]
        state["remaining"] = [5, 3]
        engine = BackgammonEngine(state)

        result = engine.reorder_dice("white")
        self.assertTrue(result["success"])
        self.assertEqual(engine.state["remaining"], [3, 5])

        move = engine.make_move(5, 0, "white")

        self.assertTrue(move["success"])
        self.assertEqual(engine.state["remaining"], [5])
        self.assertEqual(engine.state["points"][3], 1)

    def test_roll_dice_no_legal_moves_switches_turn(self):
        state = BackgammonEngine.get_initial_state()
        state["points"] = [0] * 24
        state["points"][21] = -5
        state["points"][22] = -5
        state["points"][23] = -5
        state["bar"] = {"white": 15, "black": 0}
        state["home"] = {"white": 0, "black": 0}
        state["turn"] = "white"
        state["phase"] = "rolling"
        engine = BackgammonEngine(state)
        result = engine.roll_dice(dice=(1, 2))
        self.assertEqual(result["dice"], [2, 1])
        self.assertEqual(result["remaining"], [])
        self.assertEqual(engine.state["turn"], "black")
        self.assertEqual(engine.state["phase"], "rolling")
        self.assertEqual(engine.state["message"], "No legal moves")

    def test_roll_opening_die_white_rolls_first_stays_in_opening(self):
        engine = self._engine()
        result = engine.roll_opening_die("white", die=5)
        self.assertTrue(result["success"])
        self.assertEqual(result["phase"], "opening_roll")
        self.assertEqual(engine.state["phase"], "opening_roll")
        self.assertEqual(engine.state["openingRoll"], {"white": 5, "black": None})
        self.assertEqual(engine.state["turn"], "black")
        self.assertEqual(engine.state["message"], "Waiting for opponent's roll")
        self.assertEqual(engine.state["version"], 1)

    def test_roll_opening_die_white_wins(self):
        engine = self._engine()
        engine.roll_opening_die("white", die=5)
        result = engine.roll_opening_die("black", die=2)
        self.assertTrue(result["success"])
        self.assertEqual(result["winner"], "white")
        self.assertEqual(result["both"], [5, 2])
        self.assertEqual(engine.state["phase"], "opening_result")
        self.assertEqual(engine.state["turn"], "white")
        self.assertEqual(engine.state["dice"], [5, 2])
        self.assertEqual(engine.state["remaining"], [5, 2])
        self.assertEqual(engine.state["openingRoll"], {"white": 5, "black": 2})
        self.assertEqual(engine.state["message"], "white goes first")
        self.assertEqual(engine.state["version"], 2)

    def test_roll_opening_die_black_wins(self):
        engine = self._engine()
        engine.roll_opening_die("white", die=1)
        result = engine.roll_opening_die("black", die=6)
        self.assertEqual(result["winner"], "black")
        self.assertEqual(result["both"], [1, 6])
        self.assertEqual(engine.state["turn"], "black")
        self.assertEqual(engine.state["dice"], [6, 1])
        self.assertEqual(engine.state["remaining"], [6, 1])

    def test_activate_opening_move_rebuilds_missing_dice(self):
        state = BackgammonEngine.get_initial_state()
        state.update({
            'phase': 'opening_result',
            'turn': 'white',
            'openingRoll': {'white': 5, 'black': 2},
            'dice': [],
            'remaining': [],
        })
        engine = BackgammonEngine(state)

        result = engine.activate_opening_move()

        self.assertTrue(result['success'])
        self.assertEqual(engine.state['phase'], 'moving')
        self.assertEqual(engine.state['turn'], 'white')
        self.assertEqual(engine.state['dice'], [5, 2])
        self.assertEqual(engine.state['remaining'], [5, 2])

    def test_interrupted_opening_move_is_not_a_new_turn_roll(self):
        state = BackgammonEngine.get_initial_state()
        state.update({
            'phase': 'rolling',
            'turn': 'black',
            'openingRoll': {'white': 1, 'black': 6},
            'dice': [],
            'remaining': [],
            'lastMove': None,
            'moveHistory': None,
            'message': 'black goes first',
        })
        engine = BackgammonEngine(state)

        self.assertTrue(engine.has_interrupted_opening_move())
        result = engine.activate_opening_move(allow_interrupted=True)

        self.assertTrue(result['success'])
        self.assertEqual(engine.state['phase'], 'moving')
        self.assertEqual(engine.state['dice'], [6, 1])
        self.assertEqual(engine.state['remaining'], [6, 1])

    def test_roll_opening_die_tie_resets_and_rerolls(self):
        engine = self._engine()
        result = engine.roll_opening_die("white", die=3)
        result = engine.roll_opening_die("black", die=3)
        self.assertTrue(result["success"])
        self.assertEqual(result["phase"], "opening_roll")
        self.assertEqual(engine.state["openingRoll"], {"white": None, "black": None})
        self.assertEqual(engine.state["turn"], "white")
        self.assertEqual(engine.state["message"], "Tie - roll again")

        engine.roll_opening_die("white", die=4)
        result = engine.roll_opening_die("black", die=1)
        self.assertEqual(result["winner"], "white")
        self.assertEqual(result["both"], [4, 1])
        self.assertEqual(engine.state["openingRoll"], {"white": 4, "black": 1})
        self.assertEqual(engine.state["phase"], "opening_result")

    def test_roll_opening_die_rejects_when_already_rolled(self):
        engine = self._engine()
        engine.roll_opening_die("white", die=5)
        result = engine.roll_opening_die("white", die=5)
        self.assertFalse(result["success"])
        self.assertIn("Already rolled", result["message"])

    def test_roll_opening_die_rejects_outside_opening_phase(self):
        engine = self._engine()
        engine.state["phase"] = "rolling"
        result = engine.roll_opening_die("white", die=5)
        self.assertFalse(result["success"])
        self.assertIn("Cannot roll now", result["message"])

    def test_roll_opening_die_rolls_locally_when_no_die_given(self):
        engine = self._engine()
        with patch("game.engine.BackgammonEngine._roll_die", return_value=5):
            result = engine.roll_opening_die("white")
        self.assertEqual(engine.state["openingRoll"], {"white": 5, "black": None})
