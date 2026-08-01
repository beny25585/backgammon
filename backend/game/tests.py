import asyncio
import uuid
from urllib.parse import urlencode

from channels.testing import WebsocketCommunicator
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from game.consumers import GameConsumer
from game.models import GameRoom, GameState, GameEvent, Player, RoomPlayer


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
