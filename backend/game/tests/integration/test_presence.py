import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from ...clock import deadline_for
from ...engine import BackgammonEngine
from ...models import GameRoom, GameState, Match, Player, RoomPlayer, Task
from ...presence import check_room_presence, mark_connected, mark_disconnected, mark_heartbeat, needs_admin_adjudication
from game.link.models import TournamentLink
from game.link.live import STATUS_TASK
from game.task_runner import run_task


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
        self.assertEqual(check_room_presence(
            self.room.id, 1100)['status'], 'not_started')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')

    def test_disconnect_forfeits_only_after_40_seconds_and_only_once(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_heartbeat(self.room.id, 'black-1', 1040)
        self.assertEqual(check_room_presence(
            self.room.id, 1040)['status'], 'waiting')
        mark_heartbeat(self.room.id, 'black-1', 1042)
        result = check_room_presence(self.room.id, 1042)
        self.assertEqual(
            result, {'status': 'forfeited', 'loser': 'white', 'winner': 'black'})
        self.assertEqual(check_room_presence(
            self.room.id, 1100)['status'], 'closed')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)

    @override_settings(GAMELINK_ENABLED=True)
    def test_tournament_disconnect_queues_one_official_result_at_40_seconds(self):
        link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1008, room=self.room,
        )
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_heartbeat(self.room.id, 'black-1', 1020)
        mark_heartbeat(self.room.id, 'black-1', 1040)
        self.assertEqual(check_room_presence(self.room.id, 1040)['status'], 'waiting')
        link.refresh_from_db()
        self.assertIsNone(link.result_body)
        self.assertFalse(Task.objects.filter(key=f'result:{link.pk}').exists())

        self.assertEqual(
            check_room_presence(self.room.id, 1041),
            {'status': 'forfeited', 'loser': 'white', 'winner': 'black'},
        )
        self.assertEqual(check_room_presence(self.room.id, 1042)['status'], 'closed')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)
        link.refresh_from_db()
        self.assertEqual(link.result_status, 'queued')
        self.assertEqual(link.result_body['end_reason'], 'disconnect')
        self.assertEqual(link.result_body['winner_seat'], 'p2')
        self.assertEqual(link.result_body['score'], {'p1': self.room.white_score, 'p2': 5})
        self.assertEqual(link.result_body['technical_result'], {
            'reason': 'disconnect',
            'played_score': {'p1': self.room.white_score, 'p2': self.room.black_score},
        })
        self.assertEqual(Task.objects.filter(key=f'result:{link.pk}').count(), 1)

    def test_reconnect_cancels_the_pending_forfeit(self):
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_connected(self.room.id, 'white-2', 'white', 1035)
        mark_heartbeat(self.room.id, 'black-1', 1045)
        self.assertEqual(check_room_presence(
            self.room.id, 1045)['status'], 'waiting')
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

    @override_settings(GAMELINK_ENABLED=True)
    def test_clockless_double_disconnect_resumes_once_when_both_colors_return(self):
        link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1005, room=self.room,
        )
        self.room.time_control = 'none'
        self.room.white_score, self.room.black_score = 2, 1
        self.room.last_sequence = 7
        self.room.save(update_fields=['time_control', 'white_score', 'black_score', 'last_sequence'])
        game_state = GameState.objects.get(room=self.room)
        game_state.state_data.pop('clock')
        game_state.state_data.update(turnStartedAt=None, remaining=[2], version=7)
        game_state.save(update_fields=['state_data'])
        saved_board = {key: game_state.state_data[key] for key in (
            'points', 'bar', 'home', 'phase', 'turn', 'dice', 'remaining',
        )}

        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        with patch('game.link.live.httpx.post') as post:
            with self.captureOnCommitCallbacks(execute=True):
                mark_disconnected(self.room.id, 'black-1', 1002)
        post.assert_not_called()
        delivery = Task.objects.get(name=STATUS_TASK)
        self.assertTrue(delivery.kwargs['body']['state']['presence']['needsAdminAdjudication'])
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result['status'], 'admin_required')
        self.assertEqual(result['missing'], ['black', 'white'])
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertTrue(self.room.state['presence']['needsAdminAdjudication'])
        game_state.refresh_from_db()
        paused = game_state.state_data
        self.assertNotIn('clock', paused)
        self.assertIsNone(paused['turnStartedAt'])
        self.assertEqual(paused['version'], 8)
        self.assertEqual(Task.objects.filter(name=STATUS_TASK).count(), 1)

        # Repeated connections from one color must not resume the room or rearm its forfeit.
        mark_connected(self.room.id, 'white-2', 'white', 1110)
        mark_connected(self.room.id, 'white-3', 'white', 1130)
        mark_heartbeat(self.room.id, 'white-2', 1200)
        result = check_room_presence(self.room.id, 1200)
        self.assertEqual(result, {'status': 'admin_required', 'missing': ['black']})
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data, paused)
        self.assertEqual(Task.objects.filter(name=STATUS_TASK).count(), 1)

        mark_connected(self.room.id, 'black-2', 'black', 1210)
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertFalse(needs_admin_adjudication(self.room))
        self.assertEqual(self.room.state['presence']['absentSince'], {})
        self.assertEqual((self.room.white_score, self.room.black_score), (2, 1))
        self.assertEqual(self.room.last_sequence, 9)
        game_state.refresh_from_db()
        resumed = game_state.state_data
        self.assertEqual({key: resumed[key] for key in saved_board}, saved_board)
        self.assertEqual(resumed['version'], 9)
        self.assertNotIn('clock', resumed)
        self.assertIsNone(resumed['turnStartedAt'])

        mark_heartbeat(self.room.id, 'black-2', 1211)
        self.assertEqual(check_room_presence(self.room.id, 1220), {'status': 'waiting', 'missing': []})
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data, resumed)
        self.assertCountEqual(
            [task.kwargs['body']['event_type'] for task in Task.objects.filter(name=STATUS_TASK)],
            ['admin_required', 'admin_cleared'],
        )
        self.assertFalse(Match.objects.filter(room=self.room).exists())
        self.assertFalse(Task.objects.filter(key=f'result:{link.pk}').exists())

    def test_timed_tournament_keeps_clock_and_gives_missing_color_fresh_grace(self):
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1010, room=self.room,
        )
        self.room.time_control = 'fast'
        self.room.last_sequence = 7
        self.room.save(update_fields=['time_control', 'last_sequence'])
        game_state = GameState.objects.get(room=self.room)
        game_state.state_data.update(
            turnStartedAt=1_000_000, version=7,
            clock={'white': 150_000, 'black': 30_000},
        )
        game_state.save(update_fields=['state_data'])
        original_state = game_state.state_data
        self.connect_both()

        self.assertEqual(
            check_room_presence(self.room.id, 1031),
            {'status': 'waiting', 'missing': ['black', 'white']},
        )
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data, original_state)

        mark_connected(self.room.id, 'white-2', 'white', 1070)
        self.assertEqual(
            check_room_presence(self.room.id, 1070),
            {'status': 'waiting', 'missing': ['black']},
        )
        mark_heartbeat(self.room.id, 'white-2', 1090)
        mark_heartbeat(self.room.id, 'white-2', 1109)
        self.assertEqual(
            check_room_presence(self.room.id, 1109),
            {'status': 'waiting', 'missing': ['black']},
        )
        mark_connected(self.room.id, 'black-2', 'black', 1109)
        self.assertEqual(check_room_presence(self.room.id, 1110), {'status': 'waiting', 'missing': []})

        self.room.refresh_from_db()
        self.assertFalse(needs_admin_adjudication(self.room))
        self.assertEqual(self.room.last_sequence, 7)
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data, original_state)
        self.assertEqual(
            deadline_for(game_state.state_data, self.room.time_control, self.room.target_points),
            1_160_000,
        )
        self.assertFalse(Match.objects.filter(room=self.room).exists())

    @override_settings(GAMELINK_ENABLED=True)
    def test_timed_tournament_times_out_once_without_connected_players(self):
        link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1011, room=self.room,
        )
        self.room.time_control = 'fast'
        self.room.save(update_fields=['time_control'])
        started_at = timezone.now().replace(microsecond=0)
        started = int(started_at.timestamp())
        game_state = GameState.objects.get(room=self.room)
        game_state.state_data['turnStartedAt'] = started * 1000
        game_state.save(update_fields=['state_data'])

        with (
            patch('time.time', return_value=started) as wall_time,
            patch('django.utils.timezone.now', return_value=started_at) as task_time,
        ):
            self.connect_both(now=started)
            mark_disconnected(self.room.id, 'white-1', started + 1)
            mark_disconnected(self.room.id, 'black-1', started + 2)
            watch = Task.objects.get(key=f'presence:{self.room.pk}')

            wall_time.return_value += 39
            task_time.return_value += timedelta(seconds=39)
            self.assertTrue(run_task(watch.pk))
            watch.refresh_from_db()
            self.assertEqual(watch.status, 'pending')
            self.assertEqual(watch.result, {'status': 'waiting', 'missing': ['black', 'white']})
            self.assertEqual(watch.run_at, started_at + timedelta(seconds=40))
            self.room.refresh_from_db()
            self.assertFalse(needs_admin_adjudication(self.room))
            self.assertFalse(Match.objects.filter(room=self.room).exists())

            wall_time.return_value += 1
            task_time.return_value = watch.run_at
            self.assertTrue(run_task(watch.pk))
            watch.refresh_from_db()
            self.assertEqual(watch.status, 'done')
            self.assertEqual(watch.result, {'status': 'forfeited', 'loser': 'white', 'winner': 'black'})
            self.assertFalse(run_task(watch.pk))

        self.assertEqual(check_room_presence(self.room.id, started + 41), {'status': 'closed'})
        match = Match.objects.get(room=self.room)
        self.assertEqual((match.end_reason, match.winner), ('time', 'black'))
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data['clock'], {'white': 0, 'black': 30_000})
        self.assertIsNone(game_state.state_data['turnStartedAt'])
        link.refresh_from_db()
        self.assertEqual(link.result_body['end_reason'], 'time')
        self.assertEqual(link.result_body['winner_seat'], 'p2')
        self.assertEqual(Task.objects.filter(key=f'result:{link.pk}').count(), 1)

    def test_legacy_timed_hold_resumes_saved_clock_when_first_color_returns(self):
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1012, room=self.room,
        )
        self.room.time_control = 'fast'
        self.room.last_sequence = 8
        self.room.state = {'presence': {
            'everBothConnected': True, 'needsAdminAdjudication': True,
            'absentSince': {'white': 1001, 'black': 1002},
            'pausedAtMs': 1_002_000, 'pausedTurnDelayUsedMs': 5_000,
        }}
        self.room.save(update_fields=['time_control', 'last_sequence', 'state'])
        game_state = GameState.objects.get(room=self.room)
        saved_clock = {'white': 25_000, 'black': 30_000}
        game_state.state_data.update(clock=saved_clock, turnStartedAt=None, version=8)
        game_state.save(update_fields=['state_data'])

        mark_connected(self.room.id, 'white-2', 'white', 1200)

        self.room.refresh_from_db()
        self.assertFalse(needs_admin_adjudication(self.room))
        self.assertEqual(self.room.last_sequence, 9)
        self.assertEqual(self.room.state['presence']['absentSince'], {'black': 1200})
        game_state.refresh_from_db()
        self.assertEqual(game_state.state_data['clock'], saved_clock)
        self.assertEqual(game_state.state_data['turnStartedAt'], 1_195_000)
        self.assertEqual(game_state.state_data['version'], 9)
        self.assertEqual(
            deadline_for(game_state.state_data, self.room.time_control, self.room.target_points),
            1_230_000,
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

    @override_settings(GAMELINK_ENABLED=True)
    def test_failed_admin_snapshot_delivery_remains_queued_for_retry(self):
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=1006, room=self.room,
        )
        self.room.time_control = 'none'
        self.room.save(update_fields=['time_control'])
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_disconnected(self.room.id, 'black-1', 1002)
        delivery = Task.objects.get(name=STATUS_TASK)
        with patch('game.link.live.deliver_status_event', side_effect=RuntimeError('offline')):
            self.assertFalse(run_task(delivery.pk))
        delivery.refresh_from_db()
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
        self.assertEqual(result, {'status': 'waiting',
                         'missing': ['black', 'white']})
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

    def test_clockless_linked_tournament_still_holds_after_double_disconnect(self):
        TournamentLink.objects.create(
            issuer='tournaments',
            tournament_id=17,
            fixture_id=-1003,
            room=self.room,
        )
        self.room.time_control = 'none'
        self.room.save(update_fields=['time_control'])
        self.connect_both()
        mark_disconnected(self.room.id, 'white-1', 1001)
        mark_disconnected(self.room.id, 'black-1', 1002)
        result = check_room_presence(self.room.id, 1100)
        self.assertEqual(result['status'], 'admin_required')

        self.room.refresh_from_db()
        self.assertTrue(needs_admin_adjudication(self.room))
        self.room.refresh_from_db()
        self.assertTrue(self.room.state['presence']['needsAdminAdjudication'])

    @override_settings(GAMELINK_ENABLED=True)
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
        self.assertFalse(self.room.state['presence'].get(
            'needsAdminAdjudication'))
        self.assertEqual(self.room.state['presence'].get('absentSince'), {})
        delivery = Task.objects.get(name=STATUS_TASK)
        self.assertEqual(delivery.kwargs['body']['event_type'], 'admin_cleared')
        self.assertFalse(delivery.kwargs['body']['state']['presence']['needsAdminAdjudication'])
        # Also via check path
        result = check_room_presence(self.room.id, 1201)
        self.room.refresh_from_db()
        self.assertFalse(self.room.state['presence'].get(
            'needsAdminAdjudication'))
