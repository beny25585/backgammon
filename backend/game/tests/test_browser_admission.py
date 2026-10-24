from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.engine import BackgammonEngine
from game.link.models import TournamentLink
from game.models import AiSession, GameRoom, GameState, Match, Player, RoomPlayer


class BrowserAdmissionTests(TestCase):
    def setUp(self):
        self.host = User.objects.create_user(username='admission-host')
        self.guest = User.objects.create_user(username='admission-guest')
        self.host_player = Player.objects.create(user=self.host)
        self.guest_player = Player.objects.create(user=self.guest)
        self.client = APIClient()
        self.client.force_authenticate(self.guest)

    def room(self, code):
        room = GameRoom.objects.create(code=code, status='waiting')
        RoomPlayer.objects.create(room=room, player=self.host_player, color='white')
        GameState.objects.create(room=room, state_data=BackgammonEngine.get_initial_state())
        return room

    def test_linked_room_rejects_code_without_mutation(self):
        room = self.room('LINK01')
        TournamentLink.objects.create(issuer='tournaments', tournament_id=1, fixture_id=1, room=room)
        response = self.client.post('/api/rooms/join/', {'code': room.code}, format='json')
        self.assertEqual(response.status_code, 403)
        room.refresh_from_db()
        self.assertEqual(room.status, 'waiting')
        self.assertEqual(room.players.count(), 1)

    def test_server_practice_rejects_code_without_mutation(self):
        room = self.room('AI0001')
        AiSession.objects.create(room=room)
        response = self.client.post('/api/rooms/join/', {'code': room.code}, format='json')
        self.assertEqual(response.status_code, 403)
        room.refresh_from_db()
        self.assertEqual(room.status, 'waiting')
        self.assertFalse(room.players.filter(player=self.guest_player).exists())

    @patch('game.link.live.enqueue_status_event')
    def test_unlinked_code_still_admits_second_player(self, _enqueue):
        room = self.room('OPEN01')
        response = self.client.post('/api/rooms/join/', {'code': room.code}, format='json')
        self.assertEqual(response.status_code, 200)
        room.refresh_from_db()
        self.assertEqual(room.status, 'playing')
        self.assertEqual(room.players.get(player=self.guest_player).color, 'black')


class LocalMatchOwnershipTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='local-owner')
        self.other = User.objects.create_user(username='local-other')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.payload = {
            'match_type': 'ai', 'white_player_id': None, 'black_player_id': None,
            'target_points': 7, 'white_score': 7, 'black_score': 0,
            'winner': 'white', 'games': [{'winner': 'white', 'transcript': []}],
        }

    def test_local_record_binds_authenticated_owner_and_keeps_history(self):
        response = self.client.post('/api/matches/', self.payload, format='json')
        self.assertEqual(response.status_code, 201)
        match = Match.objects.get()
        self.assertEqual(match.white_player.user_id, self.owner.pk)
        self.assertIsNone(match.black_player_id)
        history = self.client.get('/api/matches/list/')
        self.assertEqual(history.data['total'], 1)

    def test_black_human_is_not_attributed_to_ai_seat(self):
        response = self.client.post('/api/matches/', {**self.payload, 'owner_color': 'black'}, format='json')
        self.assertEqual(response.status_code, 201)
        match = Match.objects.get()
        self.assertEqual(match.black_player.user_id, self.owner.pk)
        self.assertIsNone(match.white_player_id)

    def test_other_user_cannot_be_named_even_in_local_record(self):
        response = self.client.post('/api/matches/', {**self.payload, 'white_player_id': self.other.pk}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Match.objects.exists())

    def test_online_history_remains_server_owned(self):
        response = self.client.post('/api/matches/', {**self.payload, 'match_type': 'online'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Match.objects.exists())

    def test_invalid_history_shape_is_rejected_without_record(self):
        for changes in ({'games': [1]}, {'white_score': -1}, {'winner': 'someone'}, {'games': [{'transcript': 42}]}):
            with self.subTest(changes=changes):
                response = self.client.post('/api/matches/', {**self.payload, **changes}, format='json')
                self.assertEqual(response.status_code, 400)
        self.assertFalse(Match.objects.exists())

    def test_legacy_self_id_resolves_only_to_authenticated_owner(self):
        response = self.client.post('/api/matches/', {**self.payload, 'black_player_id': self.owner.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Match.objects.get().black_player.user_id, self.owner.pk)
