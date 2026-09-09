import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from .engine import BackgammonEngine
from .models import GameRoom, GameState, Match, Player, RoomPlayer, Task
from .presence import check_room_presence, mark_connected, mark_disconnected, mark_heartbeat


class PresenceForfeitTests(TestCase):
    def setUp(self):
        white_user = User.objects.create_user(username='presence-white')
        black_user = User.objects.create_user(username='presence-black')
        white = Player.objects.create(user=white_user)
        black = Player.objects.create(user=black_user)
        self.room = GameRoom.objects.create(
            id=uuid.uuid4(), code='PRES40', status='playing', target_points=5
        )
        RoomPlayer.objects.create(room=self.room, player=white, color='white')
        RoomPlayer.objects.create(room=self.room, player=black, color='black')
        initial = BackgammonEngine.get_initial_state()
        initial['clock'] = {'white': 30000, 'black': 30000}
        GameState.objects.create(room=self.room, state_data=initial)

    def connect_both(self, now=1000):
        mark_connected(self.room.id, 'white-1', 'white', now)
        mark_connected(self.room.id, 'black-1', 'black', now)

    def test_first_player_waiting_is_never_penalized(self):
        mark_connected(self.room.id, 'white-1', 'white', 1000)
        mark_disconnected(self.room.id, 'white-1', 1001)
        self.assertEqual(check_room_presence(self.room.id, 1100)['status'], 'not_started')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')

    def test_disconnect_forfeits_only_after_40_seconds_and_only_once(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_heartbeat(self.room.id, 'black-1', 1040)
        self.assertEqual(check_room_presence(self.room.id, 1040)['status'], 'waiting')
        mark_heartbeat(self.room.id, 'black-1', 1042)
        result = check_room_presence(self.room.id, 1042)
        self.assertEqual(result, {'status': 'forfeited', 'loser': 'white', 'winner': 'black'})
        self.assertEqual(check_room_presence(self.room.id, 1100)['status'], 'closed')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)

    def test_reconnect_cancels_the_pending_forfeit(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_connected(self.room.id, 'white-2', 'white', 1035)
        mark_heartbeat(self.room.id, 'black-1', 1045)
        self.assertEqual(check_room_presence(self.room.id, 1045)['status'], 'waiting')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')

    def test_two_missing_players_require_admin_adjudication(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        with patch('game.link.live.publish_snapshot') as publish:
            publish.return_value = None
            with self.captureOnCommitCallbacks(execute=True):
                mark_disconnected(self.room.id, 'black-1', 1002)
        publish.assert_called_once()
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result['status'], 'admin_required')
        self.assertEqual(result['missing'], ['black', 'white'])
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertTrue(self.room.state['presence']['needsAdminAdjudication'])
        self.assertEqual(
            GameState.objects.get(room=self.room).state_data['clock'],
            {'white': 30000, 'black': 30000},
        )

        # Returning later does not restart the old automatic-forfeit deadline.
        mark_connected(self.room.id, 'white-2', 'white', 1110)
        mark_heartbeat(self.room.id, 'white-2', 1200)
        result = check_room_presence(self.room.id, 1200)
        self.assertEqual(result, {'status': 'admin_required', 'missing': ['black']})
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)

        mark_connected(self.room.id, 'black-2', 'black', 1210)
        result = check_room_presence(self.room.id, 1220)
        self.assertEqual(result, {'status': 'admin_required', 'missing': []})
        self.room.refresh_from_db()
        self.assertTrue(self.room.state['presence']['needsAdminAdjudication'])
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)
        self.assertEqual(
            GameState.objects.get(room=self.room).state_data['clock'],
            {'white': 30000, 'black': 30000},
        )

    def test_second_socket_keeps_player_present(self):
        self.connect_both()
        mark_connected(self.room.id, 'white-2', 'white', 1000)
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_heartbeat(self.room.id, 'white-2', 1050)
        mark_heartbeat(self.room.id, 'black-1', 1050)
        result = check_room_presence(self.room.id, 1050)
        self.assertEqual(result['missing'], [])
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')

    def test_failed_admin_snapshot_delivery_remains_queued_for_retry(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        with patch('game.link.live.publish_snapshot', side_effect=RuntimeError('offline')):
            with self.captureOnCommitCallbacks(execute=True):
                mark_disconnected(self.room.id, 'black-1', 1002)

        delivery = Task.objects.get(name='game.link.live.publish_snapshot')
        self.assertEqual(delivery.status, 'pending')
        self.assertEqual(delivery.attempts, 1)
        self.assertIn('offline', delivery.last_error)
