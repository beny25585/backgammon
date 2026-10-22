import json
import time
import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from game.link.models import LinkedIdentity
from game.models import GameRoom, Player, RoomPlayer


class RoomPerformanceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="performance-owner")
        self.player = Player.objects.create(user=self.user)
        self.other = Player.objects.create(user=User.objects.create_user(username="performance-other"))
        self.room = GameRoom.objects.create()
        RoomPlayer.objects.create(room=self.room, player=self.player, color="black")
        RoomPlayer.objects.create(room=self.room, player=self.other, color="white")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @patch("game.performance.read_performance")
    def test_room_maps_stable_ids_to_seat_colors(self, read):
        read.return_value = {str(self.player.pk): {"pr": "2.75", "matches": 3, "decisions": 50}}
        response = self.client.get("/api/performance/", {"room": str(self.room.pk)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["players"]["black"]["pr"], "2.75")
        self.assertIsNone(response.json()["players"]["white"]["pr"])

    @patch("game.performance.read_performance")
    def test_outsider_cannot_fetch_room_performance(self, read):
        outsider = User.objects.create_user(username="performance-outsider")
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get("/api/performance/", {"room": str(self.room.pk)}).status_code, 404)
        read.assert_not_called()

    @override_settings(GAMELINK_ENABLED=True, GAMELINK_ACCEPTED_ISSUERS=["tournaments"], GAMELINK_COMMAND_CLOCK_SKEW=60)
    @patch("game.performance.verify_command_signature", return_value=True)
    @patch("game.performance.read_performance")
    def test_profile_resolves_issuer_and_subject_even_after_rename(self, read, signature):
        subject = str(uuid.uuid4())
        LinkedIdentity.objects.create(issuer="tournaments", external_id=subject, user=self.user)
        self.user.username = "renamed-performance-player"
        self.user.save(update_fields=["username"])
        read.return_value = {str(self.player.pk): {"pr": "4", "matches": 1, "decisions": 10}}
        response = self.client.post("/api/link/performance/", data=json.dumps({
            "purpose": "player_performance", "iss": "tournaments", "sub": subject,
        }), content_type="application/json", HTTP_X_GAMELINK_TIMESTAMP=str(int(time.time())),
            HTTP_X_GAMELINK_ISSUER="tournaments", HTTP_X_GAMELINK_SIGNATURE="test-signature")
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with([self.player.pk])
        self.assertEqual(response.json()["pr"], "4")

    @override_settings(GAMELINK_ENABLED=True, GAMELINK_ACCEPTED_ISSUERS=["tournaments"], GAMELINK_COMMAND_CLOCK_SKEW=60)
    @patch("game.performance.read_performance")
    def test_unsigned_profile_request_is_rejected_before_read(self, read):
        response = self.client.post("/api/link/performance/", {}, format="json")
        self.assertEqual(response.status_code, 401)
        read.assert_not_called()
