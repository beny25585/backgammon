from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase, TestCase

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.game_service import record_game_end
from game.link.models import TournamentLink
from game.link.outbox import build_result_body
from game.link.tests import ResultTestBase, link_settings, make_ticket


class LinkedResultAuthorityTests(SimpleTestCase):
    def test_linked_legacy_client_cannot_claim_a_win(self):
        consumer = GameConsumer()
        consumer.room_id = 'room'
        consumer._send_error = AsyncMock()
        consumer._finalize_and_broadcast = AsyncMock()
        with patch('game.consumers.get_room', AsyncMock(return_value=SimpleNamespace(id='room'))), patch(
            'game.consumers.get_game_state', AsyncMock(return_value=SimpleNamespace(
                state_data=BackgammonEngine.get_initial_state()))), patch(
            'game.consumers.is_linked_room', AsyncMock(return_value=True)):
            async_to_sync(consumer._handle_game_ended)({'winner': 'white', 'reason': 'move'})
        consumer._send_error.assert_awaited_once()
        consumer._finalize_and_broadcast.assert_not_awaited()

    def test_full_state_forgery_is_rejected_before_reading_game_state(self):
        consumer = GameConsumer()
        consumer.room_id = 'room'
        consumer._send_error = AsyncMock()
        with patch('game.consumers.get_room', AsyncMock(return_value=object())), patch(
            'game.consumers.get_game_state', AsyncMock()) as read:
            async_to_sync(consumer._handle_intent)({'payload': {
                'state': {'phase': 'game_over', 'winner': 'white'}, 'action': 'move'}})
        consumer._send_error.assert_awaited_once()
        read.assert_not_awaited()


class RatingPolicyProvisioningTests(TestCase):
    @link_settings
    def test_only_newly_provisioned_links_receive_rating_policy(self):
        subject = str(uuid4())
        self.assertEqual(self.client.get('/api/link/enter/', {'ticket': make_ticket(sub=subject)}).status_code, 302)
        link = TournamentLink.objects.get()
        self.assertEqual(link.rating_policy, 'server-v1')
        # Returning to an old room must not upgrade its trust policy.
        link.rating_policy = ''
        link.save(update_fields=['rating_policy'])
        self.assertEqual(self.client.get('/api/link/enter/', {'ticket': make_ticket(sub=subject)}).status_code, 302)
        link.refresh_from_db()
        self.assertEqual(link.rating_policy, '')


@link_settings
class RatedResultOutboxTests(ResultTestBase):
    def test_existing_links_do_not_attest_authority(self):
        self.assertNotIn('rating_policy', build_result_body(self.link, self.room,
                         winner_color='white', end_reason='move'))

    def test_completed_server_move_preserves_policy_in_frozen_result(self):
        self.seat_both()
        self.link.rating_policy = 'server-v1'
        self.link.save(update_fields=['rating_policy'])
        record_game_end(self.room, self.winning_state(), 'white', 'single', 'move')
        body = self.body()
        self.assertEqual(body['rating_policy'], 'server-v1')
        self.assertEqual(body['end_reason'], 'move')
        self.assertEqual(body['winner_seat'], 'p1')
        record_game_end(self.room, self.winning_state(), 'white', 'single', 'move')
        self.assertEqual(self.body(), body)
