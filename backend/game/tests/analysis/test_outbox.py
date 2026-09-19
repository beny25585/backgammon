from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

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
from game.task_runner import NonRetryableTaskError


@override_settings(
    ANALYSIS_SERVICE_URL="http://analysis.test"
)
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

        deliver_now_mock.assert_called_once_with(
            task.pk
        )

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
    def test_does_not_send_before_events_complete(
        self,
        post_mock,
    ):
        self.room.last_sequence = 2
        self.room.save(
            update_fields=[
                "last_sequence"
            ]
        )

        with self.assertRaises(
            RuntimeError
        ):
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
