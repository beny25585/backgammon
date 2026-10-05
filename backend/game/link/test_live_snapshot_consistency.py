"""Queued snapshots must label the persisted state with its matching sequence."""
import json
from unittest.mock import patch

import httpx
from django.test import TestCase, override_settings

from game.models import GameRoom, GameState
from game.link.live import publish_snapshot
from game.link.models import TournamentLink


@override_settings(
    GAMELINK_ENABLED=True,
    GAMELINK_TOURNAMENTS_URL='https://tournaments.example.invalid',
    GAMELINK_RESULT_SECRET='test-live-result-secret-not-production-0123456789',
    GAMELINK_ISSUER='backgammon',
)
class LiveSnapshotConsistencyTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(
            code='LIVE42', status='playing', last_sequence=8,
            state={'presence': {'needsAdminAdjudication': True}},
            white_score=2, black_score=1,
        )
        GameState.objects.create(
            room=self.room, state_data={'phase': 'moving', 'turn': 'black', 'dice': [3, 4]},
        )
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=32, fixture_id=72, room=self.room,
        )

    def test_delayed_caller_state_is_not_labelled_with_latest_sequence(self):
        with patch('game.link.live.httpx.post') as post:
            publish_snapshot(self.room.pk, {'phase': 'opening_roll', 'turn': 'white'})
        body = json.loads(post.call_args.kwargs['content'])
        self.assertEqual(body['sequence'], 8)
        self.assertEqual(body['status'], 'playing')
        self.assertEqual(body['state']['phase'], 'moving')
        self.assertEqual(body['state']['turn'], 'black')
        self.assertEqual(body['match_score'], {'white': 2, 'black': 1})

    def test_network_failure_logs_ids_and_status_without_endpoint(self):
        request = httpx.Request('POST', 'https://private.example.invalid/api/gamelink/live/')
        response = httpx.Response(503, request=request)
        error = httpx.HTTPStatusError('private endpoint detail', request=request, response=response)
        with patch('game.link.live.httpx.post', side_effect=error):
            with self.assertLogs('game.link.live', level='WARNING') as logs:
                publish_snapshot(self.room.pk)
        message = '\n'.join(logs.output)
        self.assertIn('fixture_id=72', message)
        self.assertIn('status_code=503', message)
        self.assertNotIn('private.example.invalid', message)
        self.assertNotIn('private endpoint detail', message)

    def test_durable_delivery_can_retry_the_network_failure(self):
        with patch('game.link.live.httpx.post', side_effect=httpx.ConnectError('offline')):
            with self.assertRaises(httpx.ConnectError):
                publish_snapshot(self.room.pk, raise_on_error=True)
