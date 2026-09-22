from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from game.entry_lifecycle import expire_unstarted_room
from game.models import GameRoom, Player, RoomPlayer
from game.presence import mark_connected, mark_disconnected
from django.test import override_settings
import hashlib
import hmac
import json
import time
from game.link.signing import command_signature_base


class EntryLifecycleTests(TestCase):
    def test_targeted_cancel_only_closes_owned_waiting_room(self):
        user = User.objects.create_user('cancel-player')
        player = Player.objects.create(user=user)
        first = GameRoom.objects.create(code='FIRST1', status='waiting')
        second = GameRoom.objects.create(code='SECOND', status='waiting')
        for room in (first, second):
            RoomPlayer.objects.create(room=room, player=player, color='white')
        client = APIClient()
        client.force_authenticate(user)
        response = client.post('/api/rooms/cancel/', {'roomId': str(second.pk)}, format='json')
        self.assertEqual(response.status_code, 200)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, 'waiting')
        self.assertEqual(second.status, 'cancelled')

    def test_targeted_cancel_cannot_cancel_started_or_unowned_room(self):
        user = User.objects.create_user('safe-cancel')
        player = Player.objects.create(user=user)
        room = self.room()
        client = APIClient()
        client.force_authenticate(user)
        self.assertEqual(client.post('/api/rooms/cancel/', {'roomId': str(room.pk)}, format='json').status_code, 404)
        RoomPlayer.objects.create(room=room, player=player, color='white')
        self.assertEqual(client.post('/api/rooms/cancel/', {'roomId': str(room.pk)}, format='json').status_code, 409)
        room.refresh_from_db()
        self.assertEqual(room.status, 'playing')

    @override_settings(GAMELINK_ENABLED=True, GAMELINK_ACCEPTED_ISSUERS=['club'], GAMELINK_COMMAND_SECRETS=['entry-test-secret'])
    def test_expiry_command_requires_valid_signature(self):
        client = APIClient()
        body = json.dumps({'v': 1, 'action': 'expire_unstarted', 'fixture_id': -123}).encode()
        stamp = str(int(time.time()))
        signature = 'v1=' + hmac.new(b'entry-test-secret', command_signature_base(body, stamp), hashlib.sha256).hexdigest()
        self.assertEqual(client.post('/api/link/admin-command/', body, content_type='application/json').status_code, 401)
        response = client.post('/api/link/admin-command/', body, content_type='application/json',
            HTTP_X_GAMELINK_TIMESTAMP=stamp, HTTP_X_GAMELINK_ISSUER='club', HTTP_X_GAMELINK_SIGNATURE=signature)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'missing')

    def room(self):
        return GameRoom.objects.create(code='ENTRY1', status='playing')

    def test_deadline_is_creation_time_not_heartbeat(self):
        room = self.room()
        mark_connected(room.pk, 'white-channel', 'white')
        self.assertEqual(expire_unstarted_room(room.pk, room.created_at + timedelta(minutes=9)), 'waiting')
        self.assertEqual(expire_unstarted_room(room.pk, room.created_at + timedelta(minutes=10)), 'cancelled')
        self.assertEqual(expire_unstarted_room(room.pk), 'cancelled')

    def test_neither_player_arrived(self):
        room = self.room()
        self.assertEqual(expire_unstarted_room(room.pk, room.created_at + timedelta(minutes=10)), 'cancelled')

    def test_linked_expiry_queues_cancellation_without_a_winner(self):
        from game.link.models import TournamentLink
        room = self.room()
        link = TournamentLink.objects.create(room=room, issuer='club', tournament_id=0, fixture_id=-10)
        expire_unstarted_room(room.pk, room.created_at + timedelta(minutes=10))
        link.refresh_from_db()
        self.assertEqual(link.result_status, 'queued')
        self.assertEqual(link.result_body['status'], 'cancelled')
        self.assertFalse(link.result_body.get('winner_seat'))

    def test_both_connected_exempt_even_after_disconnecting(self):
        room = self.room()
        mark_connected(room.pk, 'w', 'white')
        mark_connected(room.pk, 'b', 'black')
        mark_disconnected(room.pk, 'w')
        mark_disconnected(room.pk, 'b')
        self.assertEqual(expire_unstarted_room(room.pk, room.created_at + timedelta(hours=1)), 'started')

    def test_stale_first_connection_does_not_mark_both_connected(self):
        room = self.room()
        mark_connected(room.pk, 'w', 'white', now=100)
        mark_connected(room.pk, 'b', 'black', now=130)
        self.assertEqual(expire_unstarted_room(room.pk, room.created_at + timedelta(minutes=10)), 'cancelled')

    def test_late_connection_cannot_resurrect_room(self):
        room = self.room()
        GameRoom.objects.filter(pk=room.pk).update(created_at=timezone.now() - timedelta(minutes=11))
        self.assertFalse(mark_connected(room.pk, 'w', 'white'))
        room.refresh_from_db()
        self.assertEqual(room.status, 'cancelled')

    def test_signed_table_deadline_precedes_room_creation(self):
        room = self.room()
        room.state = {'entryDeadline': timezone.now().timestamp() - 1}
        room.save()
        self.assertEqual(expire_unstarted_room(room.pk), 'cancelled')

    def test_player_cannot_create_two_rooms(self):
        user = User.objects.create_user('one-room')
        Player.objects.create(user=user)
        client = APIClient()
        client.force_authenticate(user)
        self.assertEqual(client.post('/api/rooms/', {}).status_code, 201)
        self.assertEqual(client.post('/api/rooms/', {}).status_code, 400)
        self.assertEqual(GameRoom.objects.count(), 1)
