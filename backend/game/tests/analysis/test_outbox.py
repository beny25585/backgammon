from unittest.mock import Mock, patch
import uuid

import httpx

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from game.analysis.outbox import (
    TASK_NAME,
    deliver_analysis,
    enqueue_match_analysis,
)
from game.models import (
    GameEvent,
    GameRoom,
    GameState,
    Match,
    Player,
    RoomPlayer,
    Task,
)
from game.task_runner import NonRetryableTaskError, run_task


@override_settings(ANALYSIS_SERVICE_URL='http://analysis.test')
class AnalysisOutboxTests(TestCase):
    def setUp(self):
        white_user = User.objects.create_user(
            username="analysis-white"
        )

        black_user = User.objects.create_user(
            username="analysis-black"
        )

        self.white = Player.objects.create(
            user=white_user
        )

        self.black = Player.objects.create(
            user=black_user
        )

        self.room = GameRoom.objects.create(
            code="ANLY01",
            status="completed",
            target_points=1,
            time_control="normal",
            white_score=1,
            black_score=0,
            last_sequence=1,
            history_sequence=1,
        )

        RoomPlayer.objects.create(
            room=self.room,
            player=self.white,
            color="white",
        )

        RoomPlayer.objects.create(
            room=self.room,
            player=self.black,
            color="black",
        )

        self.game_id = "game-analysis-1"

        GameState.objects.create(
            room=self.room,
            state_data={
                "gameId": self.game_id,
                "gameFormat": "match",
                "doublingAllowed": True,
                "maxCube": 0,
                "jacoby": False,
                "cube": 1,
            },
        )

        GameEvent.objects.create(
            room=self.room,
            player=self.room.players.get(
                color="white"
            ),
            game_id=self.game_id,
            sequence=1,
            history_sequence=1,
            event_type="roll",
            payload={
                "gameId": self.game_id,
                "turn": "white",
                "dice": [6, 3],
                "phase": "moving",
            },
        )

        self.match = Match.objects.create(
            room=self.room,
            match_type="online",
            history_sequence=1,
            target_points=1,
            white_score=1,
            black_score=0,
            winner="white",
            white_player=self.white,
            black_player=self.black,
            games=[
                {
                    "game_id": self.game_id,
                    "game_number": 1,
                    "winner": "white",
                    "win_type": "single",
                    "points_awarded": 1,
                    "score_before": {
                        "white": 0,
                        "black": 0,
                    },
                    "score_after": {
                        "white": 1,
                        "black": 0,
                    },
                    "is_crawford": False,
                }
            ],
        )

    @patch(
        "game.analysis.outbox."
        "try_deliver_analysis_now"
    )
    def test_enqueue_creates_analysis_task(
        self,
        deliver_now_mock,
    ):
        with self.captureOnCommitCallbacks(
            execute=True
        ):
            task = enqueue_match_analysis(
                self.match
            )

        self.assertEqual(
            task.name,
            TASK_NAME,
        )

        self.assertEqual(
            task.kwargs,
            {
                "match_id": str(
                    self.match.id
                )
            },
        )

        self.assertEqual(
            task.max_attempts,
            10,
        )

        self.assertEqual(
            Task.objects.count(),
            1,
        )

        deliver_now_mock.assert_not_called()
        self.assertEqual(task.key, f'analysis:{self.match.pk}')

    @patch(
        "game.analysis.outbox.httpx.post"
    )
    def test_delivers_completed_match(
        self,
        post_mock,
    ):
        response = Mock()
        response.status_code = 202
        response.json.return_value = {
            "status": "accepted",
            "analysis_id": "analysis-123",
            "match_id": str(
                self.match.id
            ),
        }

        post_mock.return_value = response

        result = deliver_analysis(
            str(self.match.id)
        )

        post_mock.assert_called_once()

        call = post_mock.call_args

        self.assertEqual(
            call.args[0],
            (
                "http://analysis.test"
                "/api/v1/internal/matches/"
            ),
        )

        sent_payload = call.kwargs["json"]

        self.assertEqual(
            sent_payload["match_id"],
            str(self.match.id),
        )

        self.assertEqual(
            sent_payload["room_id"],
            str(self.room.id),
        )

        self.assertEqual(
            sent_payload["players"]["white"][
                "player_id"
            ],
            self.white.id,
        )

        self.assertEqual(
            sent_payload["players"]["black"][
                "player_id"
            ],
            self.black.id,
        )

        self.assertEqual(
            len(sent_payload["games"]),
            1,
        )

        self.assertEqual(
            result["status"],
            "accepted",
        )

        self.assertEqual(
            result["analysis_id"],
            "analysis-123",
        )

    @patch(
        "game.analysis.outbox.httpx.post"
    )
    def test_already_existing_match_is_success(
        self,
        post_mock,
    ):
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "status": "already_exists",
            "analysis_id": "analysis-existing",
            "match_id": str(
                self.match.id
            ),
        }

        post_mock.return_value = response

        result = deliver_analysis(
            str(self.match.id)
        )

        self.assertEqual(
            result["status"],
            "already_exists",
        )

        self.assertEqual(
            result["analysis_id"],
            "analysis-existing",
        )

    @patch(
        "game.analysis.outbox.httpx.post"
    )
    def test_missing_history_blocks_delivery(
        self,
        post_mock,
    ):
        self.room.history_sequence = 2
        self.room.save(
            update_fields=[
                "history_sequence"
            ]
        )

        self.match.history_sequence = 2
        self.match.save(update_fields=['history_sequence'])
        with self.assertRaises(NonRetryableTaskError):
            deliver_analysis(
                str(self.match.id)
            )

        post_mock.assert_not_called()

    @patch(
        "game.analysis.outbox.httpx.post"
    )
    def test_server_error_is_retryable(
        self,
        post_mock,
    ):
        response = Mock()
        response.status_code = 503

        post_mock.return_value = response

        with self.assertRaises(
            RuntimeError
        ):
            deliver_analysis(
                str(self.match.id)
            )

    @patch(
        "game.analysis.outbox.httpx.post"
    )
    def test_conflict_is_non_retryable(
        self,
        post_mock,
    ):
        response = Mock()
        response.status_code = 409

        post_mock.return_value = response

        with self.assertRaises(
            NonRetryableTaskError
        ):
            deliver_analysis(
                str(self.match.id)
            )

    @override_settings(
        ANALYSIS_SERVICE_URL=""
    )
    def test_missing_service_url_is_non_retryable(
        self,
    ):
        with self.assertRaises(
            NonRetryableTaskError
        ):
            deliver_analysis(
                str(self.match.id)
            )

    def response(self):
        response = Mock(status_code=202)
        response.json.return_value = {'status': 'accepted', 'match_id': str(self.match.pk), 'analysis_id': 'analysis-123'}
        return response

    def test_enqueue_is_unique_and_leaves_work_for_the_worker(self):
        first = enqueue_match_analysis(self.match)
        second = enqueue_match_analysis(self.match)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(first.status, 'pending')
        self.assertIsNone(first.delivery_payload)
        self.assertEqual(Task.objects.count(), 1)

    @patch('game.analysis.outbox.httpx.post')
    def test_state_only_warning_does_not_block_complete_history(self, post):
        GameRoom.objects.filter(pk=self.room.pk).update(last_sequence=2)
        post.return_value = self.response()
        task = enqueue_match_analysis(self.match)
        self.assertTrue(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'done')
        post.assert_called_once()

    @patch('game.analysis.outbox.httpx.post')
    def test_last_event_cannot_hide_a_missing_middle_event(self, post):
        GameRoom.objects.filter(pk=self.room.pk).update(history_sequence=3, last_sequence=3)
        self.match.history_sequence = 3
        self.match.save(update_fields=['history_sequence'])
        GameEvent.objects.create(room=self.room, game_id=self.game_id, sequence=3,
                                 history_sequence=3, event_type='move', payload={'gameId': self.game_id})
        task = enqueue_match_analysis(self.match)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('history is incomplete', task.last_error)
        self.assertIsNone(task.delivery_payload)
        post.assert_not_called()

    @patch('game.analysis.outbox.httpx.post')
    def test_legacy_history_requires_diagnosis_instead_of_endless_retries(self, post):
        Match.objects.filter(pk=self.match.pk).update(history_sequence=None)
        task = enqueue_match_analysis(self.match)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('no verified history boundary', task.last_error)
        post.assert_not_called()

    @patch('game.analysis.outbox.httpx.post')
    def test_event_for_an_unknown_game_is_diagnosed_before_delivery(self, post):
        GameEvent.objects.filter(room=self.room).update(game_id='unrecorded-game')
        task = enqueue_match_analysis(self.match)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('does not belong to a recorded game', task.last_error)
        post.assert_not_called()

    @patch('game.analysis.outbox.httpx.post')
    def test_corrupt_event_payload_is_blocked_instead_of_retried(self, post):
        GameEvent.objects.filter(room=self.room).update(payload=['invalid'])
        task = enqueue_match_analysis(self.match)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('invalid payload', task.last_error)
        self.assertIsNone(task.delivery_payload)
        post.assert_not_called()

    @patch('game.analysis.outbox.httpx.post')
    def test_corrupt_final_state_is_diagnosed_before_delivery(self, post):
        GameState.objects.filter(room=self.room).update(state_data=[])
        task = enqueue_match_analysis(self.match)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'blocked')
        self.assertIn('Final GameState has an invalid payload', task.last_error)
        post.assert_not_called()

    @patch('game.analysis.outbox.httpx.post')
    def test_all_games_share_one_event_query(self, post):
        second_id = 'game-analysis-2'
        self.match.games.append({**self.match.games[0], 'game_id': second_id, 'game_number': 2,
                                 'score_before': {'white': 1, 'black': 0},
                                 'score_after': {'white': 2, 'black': 0}})
        self.match.history_sequence = 2
        self.match.white_score = 2
        self.match.target_points = 2
        self.match.save(update_fields=['games', 'history_sequence', 'white_score', 'target_points'])
        GameRoom.objects.filter(pk=self.room.pk).update(history_sequence=2, last_sequence=3,
                                                       white_score=2, target_points=2)
        GameEvent.objects.create(room=self.room, game_id=second_id, sequence=3, history_sequence=2,
                                 event_type='roll', payload={'gameId': second_id, 'dice': [2, 1]})
        post.return_value = self.response()
        with CaptureQueriesContext(connection) as queries:
            deliver_analysis(str(self.match.pk))
        event_reads = [entry['sql'] for entry in queries
                       if entry['sql'].lstrip().upper().startswith('SELECT')
                       and 'FROM "game_gameevent"' in entry['sql']]
        self.assertEqual(len(event_reads), 1)
        self.assertEqual([len(game['events']) for game in post.call_args.kwargs['json']['games']], [1, 1])

    @patch('game.analysis.outbox.httpx.post')
    def test_retry_after_lost_response_uses_frozen_payload_without_history_reads(self, post):
        task = enqueue_match_analysis(self.match)
        post.side_effect = httpx.ReadTimeout('Response lost after ingestion')
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        frozen = task.delivery_payload
        self.assertIsNotNone(frozen)
        self.assertEqual(task.status, 'pending')
        GameEvent.objects.filter(room=self.room).update(payload={'changed': True})
        Player.objects.filter(pk=self.white.pk).update(nickname='Changed after ingestion')
        Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
        post.side_effect = None
        post.return_value = self.response()
        with patch('game.analysis.outbox.GameEvent.objects.filter', side_effect=AssertionError('History reread')):
            self.assertTrue(run_task(task.pk))
        self.assertEqual(post.call_args.kwargs['json'], frozen)
        task.refresh_from_db()
        self.assertEqual(task.delivery_payload, frozen)
        self.assertEqual(task.status, 'done')

    @patch('game.analysis.outbox.httpx.post')
    def test_temporary_failure_keeps_retrying_after_ten_attempts(self, post):
        task = enqueue_match_analysis(self.match)
        Task.objects.filter(pk=task.pk).update(attempts=10)
        post.return_value = Mock(status_code=503)
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.attempts, 11)
        self.assertEqual(task.status, 'pending')
        self.assertGreater((task.run_at - timezone.now()).total_seconds(), 1700)
        self.assertLessEqual((task.run_at - timezone.now()).total_seconds(), 1805)

    @patch('game.analysis.outbox.httpx.post')
    def test_legacy_callable_uses_the_same_durable_delivery(self, post):
        task = Task.objects.create(name='game.analysis_outbox.deliver_analysis',
                                   kwargs={'match_id': str(self.match.pk)}, status='failed', attempts=10)
        post.return_value = self.response()
        self.assertTrue(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'done')
        self.assertIsNotNone(task.delivery_payload)

    @patch('game.analysis.outbox.httpx.post')
    def test_unacknowledged_success_keeps_the_frozen_payload_pending(self, post):
        task = enqueue_match_analysis(self.match)
        post.return_value = Mock(status_code=202)
        post.return_value.json.return_value = {'status': 'accepted', 'match_id': 'another-match'}
        self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertIsNotNone(task.delivery_payload)
        self.assertIn('did not acknowledge', task.last_error)

    @patch('game.analysis.outbox.httpx.post')
    def test_replaced_lease_cannot_freeze_or_send_a_payload(self, post):
        from game.analysis.payload import build_match_analysis_payload

        task = enqueue_match_analysis(self.match)

        def lose_lease(match, **kwargs):
            Task.objects.filter(pk=task.pk).update(lease_token=uuid.uuid4())
            return build_match_analysis_payload(match, **kwargs)

        with patch('game.analysis.outbox.build_match_analysis_payload', side_effect=lose_lease):
            self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertIsNone(task.delivery_payload)
        post.assert_not_called()
