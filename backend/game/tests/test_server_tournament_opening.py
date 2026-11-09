from datetime import timedelta
from unittest.mock import AsyncMock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from game.engine import BackgammonEngine
from game.link.live import STATUS_TASK
from game.link.models import TournamentLink
from game.models import GameEvent, GameRoom, GameState, Match, Player, RoomPlayer, Task
from game.presence import (
    WATCH_TASK,
    check_room_presence,
    confirm_room_entry,
    mark_connected,
    mark_disconnected,
    mark_heartbeat,
    needs_admin_adjudication,
)
from game.task_runner import run_task
from game.tournament_opening import CLOCK_TASK, OPENING_TASK


@override_settings(GAMELINK_ENABLED=True)
class ServerTournamentOpeningTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='OPEN02', target_points=5, time_control='fast')
        self.link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=486, room=self.room,
        )
        for color in ('white', 'black'):
            player = Player.objects.create(user=User.objects.create_user(f'server-opening-{color}'))
            RoomPlayer.objects.create(room=self.room, player=player, color=color)
        self.state = GameState.objects.create(
            room=self.room, state_data=BackgammonEngine.get_initial_state(),
        )
        self.now = timezone.now().replace(microsecond=0)

    def at(self, seconds):
        return self.now + timedelta(seconds=seconds)

    def confirm_entry(self):
        at = self.now.timestamp()
        mark_connected(self.room.pk, 'white-1', 'white', now=at)
        mark_connected(self.room.pk, 'black-1', 'black', now=at)
        self.room.refresh_from_db()
        challenge = self.room.state['presence']['entryChallenge']
        with patch('django.utils.timezone.now', return_value=self.now):
            self.assertFalse(confirm_room_entry(self.room.pk, 'white-1', challenge, now=at))
            self.assertFalse(Task.objects.filter(name=OPENING_TASK).exists())
            self.assertTrue(confirm_room_entry(self.room.pk, 'black-1', challenge, now=at))
            self.assertFalse(confirm_room_entry(self.room.pk, 'black-1', challenge, now=at))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        return Task.objects.get(name=OPENING_TASK)

    def run_at(self, task, at):
        with patch('django.utils.timezone.now', return_value=at):
            ran = run_task(task.pk)
        task.refresh_from_db()
        self.room.refresh_from_db()
        self.state.refresh_from_db()
        return ran

    def disconnect_both(self):
        mark_disconnected(self.room.pk, 'white-1', now=self.at(1).timestamp())
        mark_disconnected(self.room.pk, 'black-1', now=self.at(2).timestamp())
        check_room_presence(self.room.pk, now=self.at(2).timestamp())
        self.room.refresh_from_db()
        self.assertFalse(needs_admin_adjudication(self.room))

    @patch('game.tournament_opening.fetch_opening_dice', new_callable=AsyncMock, return_value=(6, 2))
    def test_queued_opening_starts_clock_once_even_after_both_sockets_close(self, fetch_dice):
        task = self.confirm_entry()
        self.disconnect_both()

        self.assertTrue(self.run_at(task, self.at(3)))
        self.assertEqual(task.status, 'pending')
        self.assertGreaterEqual(task.run_at, self.at(6))
        self.assertEqual(self.state.state_data['phase'], 'opening_result')
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 6, 'black': 2})
        self.assertIsNone(self.state.state_data.get('turnStartedAt'))
        self.assertFalse(self.run_at(task, self.at(5)))

        clock_start = task.run_at
        self.assertTrue(self.run_at(task, clock_start))
        self.assertEqual(task.status, 'done')
        self.assertEqual(self.state.state_data['phase'], 'moving')
        self.assertEqual(self.state.state_data['turn'], 'white')
        self.assertEqual(self.state.state_data['dice'], [6, 2])
        self.assertEqual(self.state.state_data['turnStartedAt'], int(clock_start.timestamp() * 1000))
        self.assertEqual(self.state.state_data['clock'], {'white': 150_000, 'black': 150_000})
        self.assertEqual(self.state.state_data['inactivity']['player'], 'white')

        started_state = self.state.state_data
        # A worker can die after persisting the opening and before acknowledging the task.
        Task.objects.filter(pk=task.pk).update(status='pending', run_at=self.at(8))
        self.assertTrue(self.run_at(task, self.at(8)))
        self.assertEqual(self.state.state_data, started_state)
        fetch_dice.assert_awaited_once()
        self.assertEqual(
            list(GameEvent.objects.filter(room=self.room).order_by('sequence').values_list('event_type', flat=True)),
            ['roll', 'opening_result_done'],
        )
        self.assertFalse(needs_admin_adjudication(self.room))
        self.assertEqual(
            [task.kwargs['body']['event_type'] for task in Task.objects.filter(name=STATUS_TASK)],
            ['started'],
        )

    @patch('game.tournament_opening.fetch_opening_dice', new_callable=AsyncMock, return_value=(6, 2))
    def test_delayed_first_turn_starts_before_pending_disconnect_forfeit(self, fetch_dice):
        task = self.confirm_entry()
        self.assertTrue(self.run_at(task, self.at(1)))
        self.assertEqual(self.state.state_data['phase'], 'opening_result')

        mark_disconnected(self.room.pk, 'white-1', now=self.at(2).timestamp())
        for seconds in (20, 40):
            mark_heartbeat(self.room.pk, 'black-1', now=self.at(seconds).timestamp())
        watch = Task.objects.get(name=WATCH_TASK, key=f'presence:{self.room.pk}')
        deadline = self.at(42)
        with patch('game.presence.time.time', return_value=deadline.timestamp()):
            self.assertTrue(self.run_at(watch, deadline))
        self.link.refresh_from_db()
        self.assertIsNone(self.link.result_body)
        self.assertEqual(watch.status, 'pending')

        clock_start = self.at(43)
        self.assertTrue(self.run_at(task, clock_start))
        self.assertEqual(task.status, 'done')
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual(self.state.state_data['phase'], 'moving')
        self.assertEqual(self.state.state_data['turn'], 'white')
        self.assertEqual(self.state.state_data['dice'], [6, 2])
        self.assertEqual(self.state.state_data['turnStartedAt'], int(clock_start.timestamp() * 1000))
        fetch_dice.assert_awaited_once()

        with patch('game.presence.time.time', return_value=watch.run_at.timestamp()):
            self.assertTrue(self.run_at(watch, watch.run_at))
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_body['end_reason'], 'disconnect')

    @patch('game.tournament_opening.fetch_opening_dice', new_callable=AsyncMock, return_value=(6, 2))
    def test_first_return_is_not_forfeited_using_the_startup_double_absence(self, _fetch_dice):
        task = self.confirm_entry()
        self.disconnect_both()
        self.assertTrue(self.run_at(task, self.at(3)))
        self.assertTrue(self.run_at(task, task.run_at))

        mark_connected(self.room.pk, 'white-2', 'white', now=self.at(45).timestamp())
        check_room_presence(self.room.pk, now=self.at(45).timestamp())
        self.link.refresh_from_db()
        self.assertIsNone(self.link.result_body)
        self.assertFalse(Match.objects.filter(room=self.room).exists())

        mark_connected(self.room.pk, 'black-2', 'black', now=self.at(46).timestamp())
        mark_disconnected(self.room.pk, 'black-2', now=self.at(47).timestamp())
        for seconds in (65, 85):
            mark_heartbeat(self.room.pk, 'white-2', now=self.at(seconds).timestamp())
        check_room_presence(self.room.pk, now=self.at(86).timestamp())
        self.link.refresh_from_db()
        self.assertIsNone(self.link.result_body)

        result = check_room_presence(self.room.pk, now=self.at(87).timestamp())
        self.assertEqual(result, {'status': 'forfeited', 'loser': 'black', 'winner': 'white'})
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_body['end_reason'], 'disconnect')

    @patch('game.tournament_opening.fetch_opening_dice', new_callable=AsyncMock, return_value=(6, 2))
    def test_first_turn_clock_expires_without_any_connected_socket(self, _fetch_dice):
        self.room.target_points = 1
        self.room.save(update_fields=['target_points'])
        opening = self.confirm_entry()
        self.disconnect_both()
        self.assertTrue(self.run_at(opening, self.at(3)))
        first_turn_at = opening.run_at
        self.assertTrue(self.run_at(opening, first_turn_at))
        clock = Task.objects.get(key=f'first-turn-clock:{self.room.pk}', name=CLOCK_TASK)
        deadline = first_turn_at + timedelta(seconds=40)
        self.assertEqual(clock.run_at, deadline)
        self.assertFalse(self.run_at(clock, deadline - timedelta(seconds=1)))

        with patch('game.game_service.time.time', return_value=deadline.timestamp()):
            self.assertTrue(self.run_at(clock, deadline))
            Task.objects.filter(pk=clock.pk).update(status='pending', run_at=deadline)
            self.assertTrue(self.run_at(clock, deadline))

        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(self.state.state_data['gameEndReason'], 'time')
        match = Match.objects.get(room=self.room)
        self.assertEqual((match.winner, match.end_reason), ('black', 'time'))
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_body['end_reason'], 'time')
        self.assertEqual(self.link.result_body['winner_seat'], 'p2')
