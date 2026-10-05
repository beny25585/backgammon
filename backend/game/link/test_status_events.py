"""Durable transitions must survive retries without describing a later state."""
import json
import uuid
from unittest.mock import patch

import httpx
from django.db import transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from game.models import GameRoom, GameState, Task
from game.task_runner import run_task

from . import tests as link_tests
from .live import STATUS_TASK, enqueue_status_event
from .models import RedeemedTicket, TournamentLink


class StatusEventTransactionTests(SimpleTestCase):
    def test_queueing_requires_the_room_transaction(self):
        with self.assertRaisesMessage(RuntimeError, 'inside the room transaction'):
            enqueue_status_event(None, 'started')


@link_tests.link_settings
class StatusEventStartTests(link_tests.LinkTestBase):
    def test_second_seat_queues_one_start_and_reentry_does_not_queue_another(self):
        subject = str(uuid.uuid4())
        with patch('game.link.live.httpx.post') as post:
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.enter(link_tests.make_ticket()).status_code, 302)
                self.assertFalse(Task.objects.filter(name=STATUS_TASK).exists())
                self.assertEqual(self.enter(link_tests.make_ticket(seat='p2', sub=subject)).status_code, 302)
                self.assertEqual(self.enter(link_tests.make_ticket(seat='p2', sub=subject)).status_code, 302)
        post.assert_not_called()
        task = Task.objects.get(name=STATUS_TASK)
        link = TournamentLink.objects.get()
        body = task.kwargs['body']
        self.assertEqual(body['event_type'], 'started')
        self.assertEqual(body['event_id'], str(task.pk))
        self.assertEqual(body['event_revision'], 1)
        self.assertEqual(body['status'], 'playing')
        self.assertEqual(body['started_at'], link.status_started_at.isoformat())
        self.assertEqual(link.status_event_revision, 1)

    def test_failed_outbox_write_rolls_back_second_seat_and_room_start(self):
        self.assertEqual(self.enter(link_tests.make_ticket()).status_code, 302)
        with patch('game.link.live._snapshot_body', side_effect=RuntimeError('outbox failure')):
            with self.assertRaisesMessage(RuntimeError, 'outbox failure'):
                self.enter(link_tests.make_ticket(seat='p2'))
        link = TournamentLink.objects.select_related('room').get()
        self.assertEqual(link.room.status, 'waiting')
        self.assertEqual(link.room.players.count(), 1)
        self.assertEqual(link.status_event_revision, 0)
        self.assertIsNone(link.status_started_at)
        self.assertEqual(RedeemedTicket.objects.count(), 1)
        self.assertFalse(Task.objects.filter(name=STATUS_TASK).exists())


@override_settings(
    GAMELINK_ENABLED=True,
    GAMELINK_TOURNAMENTS_URL='https://tournaments.example.invalid',
    GAMELINK_RESULT_SECRET='test-status-secret-not-production-0123456789',
    GAMELINK_ISSUER='backgammon',
)
class StatusEventDeliveryTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='STAT01', status='playing', last_sequence=4)
        GameState.objects.create(room=self.room, state_data={'phase': 'opening_roll', 'turn': 'white'})
        self.link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=32, fixture_id=72, room=self.room,
        )

    def enqueue(self, event_type='started'):
        with transaction.atomic():
            room = GameRoom.objects.select_for_update().get(pk=self.room.pk)
            return enqueue_status_event(room, event_type)

    def response(self, status, body=None):
        return httpx.Response(
            status, json=body or {},
            request=httpx.Request('POST', 'https://tournaments.example.invalid/api/gamelink/live/'),
        )

    def test_retry_keeps_body_and_identity_but_uses_fresh_nonce(self):
        task = self.enqueue()
        body = task.kwargs['body']
        GameRoom.objects.filter(pk=self.room.pk).update(last_sequence=20, white_score=5, status='completed')
        GameState.objects.filter(room=self.room).update(state_data={'phase': 'game_over', 'turn': 'black'})
        response = self.response(200, {'status': 'recorded', 'event_id': body['event_id']})
        with patch('game.link.live.httpx.post', side_effect=[httpx.ConnectError('offline'), response]) as post:
            self.assertFalse(run_task(task.pk))
            Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
            self.assertTrue(run_task(task.pk))
        first, second = post.call_args_list
        self.assertEqual(first.kwargs['content'], second.kwargs['content'])
        self.assertNotEqual(first.kwargs['headers']['X-Gamelink-Nonce'], second.kwargs['headers']['X-Gamelink-Nonce'])
        sent = json.loads(second.kwargs['content'])
        self.assertEqual(sent, body)
        self.assertEqual(sent['sequence'], 4)
        self.assertEqual(sent['state']['phase'], 'opening_roll')
        task.refresh_from_db()
        self.assertEqual(task.status, 'done')
        self.assertEqual(task.attempts, 2)

    def test_rollback_removes_event_and_revision(self):
        with self.assertRaisesMessage(RuntimeError, 'rollback'):
            with transaction.atomic():
                self.enqueue()
                raise RuntimeError('rollback')
        self.link.refresh_from_db()
        self.assertEqual(self.link.status_event_revision, 0)
        self.assertFalse(Task.objects.filter(name=STATUS_TASK).exists())

    def test_transient_failure_retries_beyond_default_attempt_limit(self):
        for status in (408, 429, 503):
            with self.subTest(status=status):
                task = self.enqueue()
                Task.objects.filter(pk=task.pk).update(attempts=task.max_attempts)
                with patch('game.link.live.httpx.post', return_value=self.response(status)):
                    self.assertFalse(run_task(task.pk))
                task.refresh_from_db()
                self.assertEqual(task.status, 'pending')
                self.assertGreater(task.run_at, timezone.now())

    def test_permanent_refusal_blocks_for_operator_review(self):
        task = self.enqueue()
        with patch('game.link.live.httpx.post', return_value=self.response(403)):
            self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('HTTP 403', task.last_error)

    def test_old_receiver_acknowledgement_keeps_event_pending(self):
        task = self.enqueue()
        with patch('game.link.live.httpx.post', return_value=self.response(200, {'status': 'recorded'})):
            self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')

    def test_acknowledged_duplicate_completes_the_task(self):
        task = self.enqueue()
        response = self.response(200, {'status': 'already_recorded', 'event_id': str(task.pk)})
        with patch('game.link.live.httpx.post', return_value=response):
            self.assertTrue(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'done')
        self.assertEqual(task.result['status'], 'already_recorded')
