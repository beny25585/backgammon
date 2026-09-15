import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from .engine import BackgammonEngine
from .models import GameRoom, GameState, Match, Player, RoomPlayer, Task
from .presence import check_room_presence, mark_connected, mark_disconnected, mark_heartbeat, needs_admin_adjudication
from game.link.models import TournamentLink


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
        initial.update(phase='moving', dice=[3, 2], remaining=[3, 2])
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

    def test_disconnect_before_opening_roll_does_not_start_a_forfeit(self):
        self.connect_both()
        game_state = GameState.objects.get(room=self.room)
        game_state.state_data.update(
            phase='opening_roll', dice=[], remaining=[],
            openingRoll={'white': None, 'black': None},
        )
        game_state.save(update_fields=['state_data', 'updated_at'])

        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_heartbeat(self.room.id, 'black-1', 1100)
        self.assertEqual(
            check_room_presence(self.room.id, 1100),
            {'status': 'waiting_to_start', 'missing': ['white']},
        )
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)

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

    def test_linked_h2h_does_not_request_organizer(self):
        TournamentLink.objects.create(
            issuer='tournaments',
            tournament_id=0,
            fixture_id=-1001,
            room=self.room,
        )
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_disconnected(self.room.id, 'black-1', 1002)
        self.room.refresh_from_db()
        self.assertFalse(self.room.state['presence']['needsAdminAdjudication'])
        self.assertFalse(needs_admin_adjudication(self.room))
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result, {'status': 'waiting', 'missing': ['black', 'white']})
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)

    def test_linked_h2h_reconnect_gets_fresh_timer(self):
        TournamentLink.objects.create(
            issuer='tournaments',
            tournament_id=0,
            fixture_id=-1002,
            room=self.room,
        )
        self.connect_both(now=1000)
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_disconnected(self.room.id, 'black-1', 1002)
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(result['missing'], ['black', 'white'])
        self.assertFalse(needs_admin_adjudication(self.room))
        mark_connected(self.room.id, 'white-2', 'white', 1110)
        mark_heartbeat(self.room.id, 'white-2', 1110)
        result = check_room_presence(self.room.id, 1110)
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(result['missing'], ['black'])
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)
        mark_heartbeat(self.room.id, 'white-2', 1130)
        result = check_room_presence(self.room.id, 1130)
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 0)
        mark_heartbeat(self.room.id, 'white-2', 1155)
        result = check_room_presence(self.room.id, 1155)
        self.assertEqual(result['status'], 'forfeited')
        self.assertEqual(result['loser'], 'black')
        self.assertEqual(result['winner'], 'white')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)

    def test_real_linked_tournament_still_requires_organizer(self):
        TournamentLink.objects.create(
            issuer='tournaments',
            tournament_id=17,
            fixture_id=-1003,
            room=self.room,
        )
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_disconnected(self.room.id, 'black-1', 1002)
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result['status'], 'admin_required')

        self.room.refresh_from_db()
        self.assertTrue(needs_admin_adjudication(self.room))
        self.room.refresh_from_db()
        self.assertTrue(self.room.state['presence']['needsAdminAdjudication'])

    def test_stale_flag_recovered_for_h2h(self):
        TournamentLink.objects.create(
            issuer='tournaments',
            tournament_id=0,
            fixture_id=-1004,
            room=self.room,
        )
        # Simulate room persisted before fix with sticky flag
        self.room.refresh_from_db()
        state = dict(self.room.state or {})
        presence = dict(state.get('presence') or {})
        presence['needsAdminAdjudication'] = True
        presence['absentSince'] = {'white': 1000}
        state['presence'] = presence
        self.room.state = state
        self.room.save(update_fields=['state', 'updated_at'])
        self.assertFalse(needs_admin_adjudication(self.room))
        mark_connected(self.room.id, 'white-1', 'white', 1200)
        self.room.refresh_from_db()
        self.assertFalse(self.room.state['presence'].get('needsAdminAdjudication'))
        self.assertEqual(self.room.state['presence'].get('absentSince'), {})
        # Also via check path
        result = check_room_presence(self.room.id, 1201)
        self.room.refresh_from_db()
        self.assertFalse(self.room.state['presence'].get('needsAdminAdjudication'))
