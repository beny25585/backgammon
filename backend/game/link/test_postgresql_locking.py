"""Exercise actual PostgreSQL lock contention, rather than SQLite no-op locks."""
import hashlib
import hmac
import json
import time
import uuid
from io import StringIO
from queue import Queue
from threading import Event, Thread
from unittest import skipUnless

from django.core.management import call_command
from django.db import connection, connections, transaction
from django.test import RequestFactory, TransactionTestCase, override_settings

from game.models import GameRoom, GameState

from . import tests as contracts
from .models import TournamentLink
from .signing import command_signature_base
from .views import admin_command


@skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL row locks')
@contracts.link_settings
@override_settings(CHANNEL_LAYERS={
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
})
class LinkedRoomLockOrderTests(TransactionTestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='PGLOCK', status='playing', target_points=5)
        GameState.objects.create(room=self.room, state_data={'phase': 'moving'})
        self.link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=7, fixture_id=42, room=self.room,
        )

    def assert_room_is_locked_before_link(self, operation):
        backend_pid = Queue()
        finished = Event()
        results, errors = [], []

        def worker():
            database = connections['default']
            try:
                with database.cursor() as cursor:
                    cursor.execute("SET lock_timeout TO '8s'")
                    cursor.execute('SELECT pg_backend_pid()')
                    backend_pid.put(cursor.fetchone()[0])
                results.append(operation())
            except Exception as error:
                errors.append(error)
            finally:
                database.close()
                finished.set()

        thread = Thread(target=worker, daemon=True)
        try:
            with transaction.atomic():
                GameRoom.objects.select_for_update().get(pk=self.room.pk)
                thread.start()
                pid = backend_pid.get(timeout=5)
                blocked = False
                deadline = time.monotonic() + 4
                with connection.cursor() as cursor:
                    while not finished.is_set() and time.monotonic() < deadline:
                        cursor.execute(
                            'SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = %s AND NOT granted)',
                            [pid],
                        )
                        if cursor.fetchone()[0]:
                            blocked = True
                            break
                        finished.wait(0.02)
                self.assertTrue(blocked, f'Operation did not wait for the room: {errors}')
                # While the other session waits for our room, it must not hold
                # the link and prevent this room owner from queueing a status.
                TournamentLink.objects.select_for_update(nowait=True).get(pk=self.link.pk)
        finally:
            if thread.ident is not None:
                thread.join(timeout=10)
        self.assertFalse(thread.is_alive(), 'Operation did not finish after the room was released')
        self.assertEqual(errors, [])
        return results[0]

    def test_admin_score_waits_for_room_without_holding_link(self):
        body = {
            'v': 1, 'command_id': str(uuid.uuid4()), 'room_id': str(self.room.pk),
            'fixture_id': 42, 'command_revision': 1, 'action': 'score_update',
            'score': [2, 1], 'winner_seat': None, 'reason': '',
        }
        raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
        timestamp = str(int(time.time()))
        signature = hmac.new(
            contracts.COMMAND_SECRET.encode(), command_signature_base(raw, timestamp), hashlib.sha256,
        ).hexdigest()

        def update_score():
            request = RequestFactory().post(
                '/api/link/admin-command/', raw, content_type='application/json',
                HTTP_X_GAMELINK_TIMESTAMP=timestamp, HTTP_X_GAMELINK_ISSUER='tournaments',
                HTTP_X_GAMELINK_SIGNATURE=f'v1={signature}',
            )
            return admin_command(request).status_code

        self.assertEqual(self.assert_room_is_locked_before_link(update_score), 200)
        self.room.refresh_from_db()
        self.assertEqual((self.room.white_score, self.room.black_score), (2, 1))

    def test_cleanup_waits_for_room_without_holding_link(self):
        def cleanup():
            output = StringIO()
            call_command('cancel_linked_rooms', tournament_id=7, execute=True, stdout=output)
            return output.getvalue()

        output = self.assert_room_is_locked_before_link(cleanup)
        self.assertIn('Cancelled and detached 1', output)
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'cancelled')
        self.assertFalse(TournamentLink.objects.filter(pk=self.link.pk).exists())
