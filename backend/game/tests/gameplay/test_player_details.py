from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from game.link.models import TournamentLink
from game.models import GameRoom, Player, RoomPlayer


@override_settings(GAMELINK_ENABLED=True, GAMELINK_TOURNAMENTS_URL='https://tournaments.example',
                   GAMELINK_RESULT_SECRET='test-player-details-secret-0123456789')
class RoomPlayerDetailsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='details-player')
        self.player = Player.objects.create(user=self.user, rating=12)
        self.room = GameRoom.objects.create()
        RoomPlayer.objects.create(room=self.room, player=self.player, color='black')
        self.link = TournamentLink.objects.create(room=self.room, issuer='tournaments',
            fixture_id=-12, tournament_id=0, seat_p1_color='black')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f'/api/rooms/{self.room.pk}/player-details/'

    @patch('game.player_details.httpx.post')
    def test_uses_signed_canonical_seats_and_not_legacy_rating(self, remote):
        remote.return_value = Mock(json=lambda: {'players': {
            'p1': {'rating': 1562, 'balance': '65800.00'},
            'p2': {'rating': 1063, 'balance': '3770.00'},
        }})
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['players']['black'], {'rating': 1562, 'balance': '65800.00'})
        self.assertEqual(response.json()['players']['white']['rating'], 1063)
        self.assertIn('X-Gamelink-Signature', remote.call_args.kwargs['headers'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    @patch('game.player_details.httpx.post')
    def test_outsider_never_reaches_account_service(self, remote):
        self.client.force_authenticate(User.objects.create_user(username='details-outsider'))
        self.assertEqual(self.client.get(self.url).status_code, 404)
        remote.assert_not_called()

    @patch('game.player_details.httpx.post')
    def test_invalid_balance_is_unavailable_instead_of_zero(self, remote):
        remote.return_value = Mock(json=lambda: {'players': {
            'p1': {'rating': 1562, 'balance': 'NaN'}, 'p2': None,
        }})
        self.assertEqual(self.client.get(self.url).status_code, 503)

    @patch('game.player_details.httpx.post')
    def test_unlinked_room_has_no_fabricated_accounts(self, remote):
        self.link.delete()
        response = self.client.get(self.url)
        self.assertEqual(response.json(), {'players': {}})
        remote.assert_not_called()
