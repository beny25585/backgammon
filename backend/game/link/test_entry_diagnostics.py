import uuid
from unittest.mock import patch

from django.test import TestCase

from game.consumers import GameConsumer
from game.link.signing import TicketError
from game.link.tests import link_settings, make_ticket


@link_settings
class EntryDiagnosticsTests(TestCase):
    def test_invalid_ticket_logs_reason_without_credentials_or_exception_text(self):
        secret = 'sensitive-test-bearer-must-not-appear'
        with patch('game.link.views.verify_ticket', side_effect=TicketError(secret)):
            with self.assertLogs('game.link.views', level='WARNING') as logs:
                response = self.client.get('/api/link/enter/', {'ticket': secret})
        self.assertEqual(response.status_code, 400)
        text = '\n'.join(logs.output)
        self.assertIn('event=game_entry_refused', text)
        self.assertIn('reason=invalid_ticket', text)
        self.assertNotIn(secret, text)

    def test_waiting_log_marks_missing_seat_once_not_every_reentry(self):
        external_id = str(uuid.uuid4())
        with self.assertLogs('game.link.views', level='INFO') as logs:
            for _ in range(2):
                response = self.client.get('/api/link/enter/', {'ticket': make_ticket(sub=external_id)})
                self.assertEqual(response.status_code, 302)
        waiting = [line for line in logs.output if 'event=game_start_waiting' in line]
        self.assertEqual(len(waiting), 1)
        self.assertIn('fixture_id=482', waiting[0])
        self.assertIn('seat=p1', waiting[0])
        self.assertIn('missing_colors=black', waiting[0])
        self.assertIn('missing_seats=p2', waiting[0])

    def test_socket_diagnostics_never_include_query_credentials(self):
        consumer = GameConsumer()
        consumer.scope = {'query_string': b'token=sensitive-socket-token'}
        consumer.room_id = 'invalid-supplied-room-sensitive-token'
        consumer.incident_connection_id = 'test-connection'
        with self.assertLogs('game.consumers', level='WARNING') as logs:
            consumer._socket_entry_event('socket_auth_refused', reason='invalid_token')
        text = '\n'.join(logs.output)
        self.assertIn('room_id=invalid', text)
        self.assertIn('reason=invalid_token', text)
        self.assertNotIn('sensitive-socket-token', text)
        self.assertNotIn('invalid-supplied-room-sensitive-token', text)
