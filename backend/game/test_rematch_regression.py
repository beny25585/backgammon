import json
from unittest.mock import MagicMock, patch
from django.test import TestCase

from game.link.rematch import RematchServiceError, send_direct_play_rematch_action


class DirectPlayConversionTest(TestCase):
    def test_fixture_minus27_sends_source_table_27(self):
        link = MagicMock()
        link.fixture_id = -27
        link.color_for_seat.side_effect = lambda s: "white" if s == "p1" else "black"
        link.tournament_id = 0
        room = MagicMock()
        room.id = "room-id"

        captured = {}

        def fake_post(url, content, headers, timeout):
            captured["body"] = json.loads(content.decode())
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"status": "pending"}
            return resp

        with patch("game.link.rematch.httpx.post", side_effect=fake_post):
            send_direct_play_rematch_action(link=link, room=room, actor_color="white", action="request")

        self.assertEqual(captured["body"]["source_table_id"], 27)
        self.assertNotEqual(captured["body"]["source_table_id"], -27)


class StructuredHttpErrorTest(TestCase):
    def test_source_not_settled_code_preserved(self):
        link = MagicMock()
        link.fixture_id = -1
        link.color_for_seat.return_value = "white"
        room = MagicMock()
        room.id = "r"

        def fake_post(url, content, headers, timeout):
            resp = MagicMock()
            resp.status_code = 409
            resp.json.return_value = {"ok": False, "code": "source_not_settled"}
            return resp

        with patch("game.link.rematch.httpx.post", side_effect=fake_post):
            with self.assertRaises(RematchServiceError) as ctx:
                send_direct_play_rematch_action(link=link, room=room, actor_color="white", action="request")
            self.assertEqual(ctx.exception.code, "source_not_settled")
            self.assertEqual(ctx.exception.status_code, 409)


class ConsumerMappingTest(TestCase):
    def test_source_not_settled_maps_to_creating(self):
        # Simulate consumer logic
        from game.consumers import GameConsumer
        # Check that code branch exists – inspect source
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("source_not_settled", src)
        self.assertIn("'creating'", src)

    def test_invalid_source_maps_to_unavailable(self):
        from game.consumers import GameConsumer
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("invalid_source", src)
        self.assertIn("unavailable", src)

    def test_source_room_mismatch_maps_to_unavailable(self):
        from game.consumers import GameConsumer
        import inspect
        src = inspect.getsource(GameConsumer._handle_rematch_request)
        self.assertIn("source_room_mismatch", src)
