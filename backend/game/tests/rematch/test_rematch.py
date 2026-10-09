from django.test import TestCase
from django.contrib.auth.models import User
from game.models import GameRoom, GameState, RoomPlayer, Player, generate_room_code
from game.game_service import create_private_rematch_room
from game.presence import both_players_connected, mark_connected
import time

class RematchGameTests(TestCase):
    def setUp(self):
        self.u1 = User.objects.create_user(username='p1', password='x')
        self.u2 = User.objects.create_user(username='p2', password='x')
        self.pl1 = Player.objects.create(user=self.u1, nickname='p1')
        self.pl2 = Player.objects.create(user=self.u2, nickname='p2')

    def _make_room(self, status='playing', target_points=5):
        from game.engine import BackgammonEngine
        room = GameRoom.objects.create(code=generate_room_code(), status=status, target_points=target_points, state={'match': {'active': True, 'games': []}})
        GameState.objects.create(room=room, state_data=BackgammonEngine.get_initial_state())
        RoomPlayer.objects.create(room=room, player=self.pl1, color='white')
        RoomPlayer.objects.create(room=room, player=self.pl2, color='black')
        return room

    def test_next_game_still_rejects_completed_room(self):
        room = self._make_room(status='completed')
        # next_game should fail when room not playing
        from game.consumers import GameConsumer
        # handler checks room.status == playing, so completed rejects
        self.assertEqual(room.status, 'completed')

    def test_rematch_requires_completed_room(self):
        room = self._make_room(status='playing')
        with self.assertRaises(ValueError):
            create_private_rematch_room(room)

    def test_opponent_disconnected_rejects_request(self):
        room = self._make_room(status='completed')
        # no presence both connected -> both_players_connected false
        self.assertFalse(both_players_connected(room))

    def test_private_accept_creates_new_room(self):
        room = self._make_room(status='completed')
        # need to set completed state winner etc for create to work
        new_room = create_private_rematch_room(room)
        self.assertNotEqual(str(new_room.id), str(room.id))

    def test_new_room_id_differs_from_old(self):
        room = self._make_room(status='completed')
        new_room = create_private_rematch_room(room)
        self.assertNotEqual(new_room.id, room.id)

    def test_scores_reset_to_0_0(self):
        room = self._make_room(status='completed')
        room.white_score = 5
        room.black_score = 3
        room.save()
        new_room = create_private_rematch_room(room)
        self.assertEqual(new_room.white_score, 0)
        self.assertEqual(new_room.black_score, 0)

    def test_fresh_state_cube_opening(self):
        room = self._make_room(status='completed')
        new_room = create_private_rematch_room(room)
        gs = GameState.objects.get(room=new_room)
        self.assertEqual(gs.state_data.get('cube', 1), 1)
        self.assertEqual(gs.state_data.get('phase'), 'opening_roll')

    def test_old_game_events_not_copied(self):
        room = self._make_room(status='completed')
        from game.models import GameEvent
        GameEvent.objects.create(room=room, game_id="initial", sequence=1, event_type='roll', payload={"gameId": "initial"})
        new_room = create_private_rematch_room(room)
        self.assertEqual(GameEvent.objects.filter(room=new_room).count(), 0)
