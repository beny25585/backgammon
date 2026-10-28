"""Spectator credentials, read-only protocol, and shared Redis capacity.

The real Lua concurrency cases run only against SPECTATOR_TEST_REDIS_URL, an
explicit disposable test Redis. They never fall back to the runtime Redis.
"""

import asyncio
import copy
import os
import time
import uuid
from unittest import skipUnless
from unittest.mock import patch

from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.core import signing
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import path

from game.engine import BackgammonEngine
from game.link.models import LinkedIdentity, TournamentLink
from game.models import GameRoom, GameState, Player, RoomPlayer
from game.spectator_consumer import SpectatorConsumer
from game.spectators import (
    SPECTATOR_SALT, SpectatorError, SpectatorLeases, public_state,
    renew_spectator_ticket, spectator_snapshot, verify_spectator_ticket,
)


SECRET = 'spectator-tests-only-not-a-production-secret'
SETTINGS = {
    'GAMELINK_ENABLED': True,
    'GAMELINK_TICKET_SECRETS': [SECRET],
    'GAMELINK_ISSUER': 'backgammon',
    'GAMELINK_ACCEPTED_ISSUERS': ['tournaments'],
}


def claims_for(room_id, **changes):
    now = int(time.time())
    return {
        'v': 1, 'role': 'spectator', 'iss': 'tournaments', 'aud': 'backgammon',
        'sub': str(uuid.uuid4()), 'trn': 12, 'fix': 34, 'room': str(room_id),
        'iat': now, 'exp': now + 120, 'jti': str(uuid.uuid4()), **changes,
    }


def signed(claims, *, salt=SPECTATOR_SALT):
    return signing.dumps(claims, key=SECRET, salt=salt)


@override_settings(**SETTINGS)
class SpectatorCredentialTests(SimpleTestCase):
    def test_player_ticket_salt_and_other_room_are_rejected(self):
        room_id = uuid.uuid4()
        claims = claims_for(room_id)
        for ticket, target in (
            (signed(claims, salt='gamelink.ticket.v1'), room_id),
            (signed(claims), uuid.uuid4()),
        ):
            with self.assertRaises(SpectatorError) as caught:
                verify_spectator_ticket(ticket, target)
            self.assertEqual(caught.exception.code, 'forbidden')

    def test_expired_ticket_has_distinct_code(self):
        room_id = uuid.uuid4()
        now = int(time.time())
        with self.assertRaises(SpectatorError) as caught:
            verify_spectator_ticket(signed(claims_for(
                room_id, iat=now - 121, exp=now - 1)), room_id)
        self.assertEqual(caught.exception.code, 'expired')

    def test_role_identifiers_and_lifetime_are_strict(self):
        room_id = uuid.uuid4()
        now = int(time.time())
        for changes in ({'role': 'player'}, {'trn': True}, {'fix': -1},
                        {'sub': 'not-a-uuid'}, {'exp': now + 121}, {'iat': now + 30}):
            with self.subTest(changes=changes), self.assertRaises(SpectatorError):
                verify_spectator_ticket(signed(claims_for(room_id, **changes)), room_id)

    def test_renewal_preserves_room_and_role_and_rotates_ticket_id(self):
        room_id = uuid.uuid4()
        claims = claims_for(room_id)
        with override_settings(GAMELINK_TICKET_SECRETS=['rotated-secret', SECRET]):
            ticket = renew_spectator_ticket(claims)
            renewed = verify_spectator_ticket(ticket, room_id)
        self.assertEqual(renewed['role'], 'spectator')
        self.assertEqual(renewed['room'], claims['room'])
        self.assertEqual(renewed['sub'], claims['sub'])
        self.assertNotEqual(renewed['jti'], claims['jti'])

    def test_public_state_excludes_private_or_growing_data(self):
        state = BackgammonEngine.get_initial_state()
        state.update(openingDice=[6, 5], moveHistory=[{'private': True}],
                     adminEndReason='private note', futurePrivateField='secret')
        result = public_state(state, version=9)
        self.assertEqual(result['version'], 9)
        for key in ('openingDice', 'moveHistory', 'adminEndReason', 'futurePrivateField'):
            self.assertNotIn(key, result)
        result['points'][0] = 99
        self.assertNotEqual(state['points'][0], 99)


@override_settings(**SETTINGS)
class SpectatorSnapshotTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(
            code='WATCH2', status='playing', last_sequence=7,
            state={'presence': {'marker': 'unchanged'}},
        )
        GameState.objects.create(room=self.room, state_data=BackgammonEngine.get_initial_state())
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=12, fixture_id=34, room=self.room,
        )
        self.claims = claims_for(self.room.pk)

    def test_snapshot_creates_no_players_and_changes_no_presence_or_state(self):
        before_room = copy.deepcopy(self.room.state)
        before_state = copy.deepcopy(self.room.gamestate.state_data)
        snapshot = spectator_snapshot(self.claims)
        self.room.refresh_from_db()
        self.room.gamestate.refresh_from_db()
        self.assertEqual(self.room.state, before_room)
        self.assertEqual(self.room.gamestate.state_data, before_state)
        self.assertFalse(RoomPlayer.objects.filter(room=self.room).exists())
        self.assertEqual(snapshot['payload']['version'], 7)

    def test_own_player_seat_and_wrong_fixture_are_refused(self):
        user = User.objects.create_user('watch-seated-player')
        player, _ = Player.objects.get_or_create(user=user)
        RoomPlayer.objects.create(room=self.room, player=player, color='white')
        LinkedIdentity.objects.create(issuer='tournaments', external_id=self.claims['sub'], user=user)
        with self.assertRaises(SpectatorError):
            spectator_snapshot(self.claims)
        with self.assertRaises(SpectatorError):
            spectator_snapshot({**self.claims, 'fix': 999})


class FakeLeasePool:
    """Protocol test double; real atomic semantics are covered by Redis cases."""
    def __init__(self):
        self.owners = {}
        self.fail = False

    def __call__(self, room_id, owner):
        pool = self

        class Lease:
            async def apply(self, operation):
                if pool.fail:
                    raise ConnectionError('redis unavailable')
                owners = pool.owners.setdefault(str(room_id), set())
                if operation == 'reserve':
                    if len(owners) >= 2:
                        return False
                    owners.add(owner)
                    return True
                if operation == 'release':
                    owners.discard(owner)
                    return True
                return owner in owners

            async def close(self):
                pass

        return Lease()


@override_settings(**SETTINGS, CHANNEL_LAYERS={
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
})
class SpectatorProtocolTests(SimpleTestCase):
    def setUp(self):
        self.room_id = uuid.uuid4()
        self.pool = FakeLeasePool()
        self.snapshot = {
            'status': 'playing',
            'payload': public_state(BackgammonEngine.get_initial_state(), version=7),
            'meta': {'whiteName': 'White', 'blackName': 'Black', 'targetPoints': 7,
                     'matchScore': {'white': 0, 'black': 0}, 'timeControl': 'normal'},
        }
        self.application = URLRouter([
            path('ws/watch/<uuid:room_id>/', SpectatorConsumer.as_asgi()),
        ])
        self.lease_patch = patch('game.spectator_consumer.SpectatorLeases', self.pool)
        self.snapshot_patch = patch('game.spectator_consumer.spectator_snapshot',
                                    side_effect=lambda claims: copy.deepcopy(self.snapshot))
        self.revision_patch = patch('game.spectator_consumer.spectator_revision',
                                   side_effect=lambda room_id: {
                                       'status': self.snapshot['status'],
                                       'last_sequence': self.snapshot['payload']['version'],
                                       'white_score': self.snapshot['meta']['matchScore']['white'],
                                       'black_score': self.snapshot['meta']['matchScore']['black'],
                                   })
        self.lease_patch.start()
        self.snapshot_loader = self.snapshot_patch.start()
        self.revision_loader = self.revision_patch.start()
        self.addCleanup(self.lease_patch.stop)
        self.addCleanup(self.snapshot_patch.stop)
        self.addCleanup(self.revision_patch.stop)

    async def open_viewer(self):
        socket = WebsocketCommunicator(self.application, f'/ws/watch/{self.room_id}/')
        connected, _ = await socket.connect()
        self.assertTrue(connected)
        await socket.send_json_to({'type': 'spectator_auth',
                                   'ticket': signed(claims_for(self.room_id))})
        return socket, await socket.receive_json_from()

    async def test_third_tab_is_full_and_disconnect_releases_one_slot(self):
        first, first_state = await self.open_viewer()
        second, second_state = await self.open_viewer()
        third, full = await self.open_viewer()
        self.assertEqual(first_state['type'], 'spectator_state')
        self.assertEqual(second_state['type'], 'spectator_state')
        self.assertEqual(full, {'type': 'spectator_error', 'code': 'full'})
        await third.disconnect()
        await second.disconnect()
        fourth, admitted = await self.open_viewer()
        self.assertEqual(admitted['type'], 'spectator_state')
        await fourth.disconnect()
        await first.disconnect()

    async def test_gameplay_message_is_refused_and_lease_released(self):
        socket, _ = await self.open_viewer()
        await socket.send_json_to({'type': 'leave'})
        self.assertEqual(await socket.receive_json_from(),
                         {'type': 'spectator_error', 'code': 'forbidden'})
        await socket.disconnect()
        self.assertFalse(self.pool.owners[str(self.room_id)])

    async def test_expired_owner_cannot_renew(self):
        socket, _ = await self.open_viewer()
        self.pool.owners[str(self.room_id)].clear()
        await socket.send_json_to({'type': 'spectator_ping'})
        self.assertEqual(await socket.receive_json_from(),
                         {'type': 'spectator_error', 'code': 'expired'})
        await socket.disconnect()

    async def test_old_group_state_and_presence_are_not_forwarded(self):
        from channels.layers import get_channel_layer
        socket, _ = await self.open_viewer()
        layer = get_channel_layer()
        group = f'game_{self.room_id}'
        await layer.group_send(group, {'type': 'player_joined', 'playerColor': 'white'})
        await layer.group_send(group, {'type': 'game_message', 'event_type': 'state_update',
                                       'payload': {**self.snapshot['payload'], 'version': 6}})
        await layer.group_send(group, {'type': 'game_message', 'event_type': 'state_update',
                                       'payload': {**self.snapshot['payload'], 'version': 8,
                                                   'moveHistory': ['private']}})
        message = await socket.receive_json_from()
        self.assertEqual(message['payload']['version'], 8)
        self.assertNotIn('moveHistory', message['payload'])
        await socket.disconnect()

    async def test_game_end_keeps_match_open_and_final_end_releases_slot(self):
        from channels.layers import get_channel_layer
        socket, _ = await self.open_viewer()
        layer = get_channel_layer()
        await layer.group_send(f'game_{self.room_id}', {'type': 'game_ended', 'payload': {}})
        self.assertEqual((await socket.receive_json_from())['type'], 'spectator_state')
        self.snapshot['status'] = 'completed'
        await layer.group_send(f'game_{self.room_id}', {'type': 'game_ended', 'payload': {}})
        final = await socket.receive_json_from()
        self.assertEqual(final['type'], 'spectator_end')
        self.assertIn('meta', final)
        await socket.disconnect()
        self.assertFalse(self.pool.owners[str(self.room_id)])

    async def test_redis_failure_closes_without_forwarding(self):
        socket, _ = await self.open_viewer()
        self.pool.fail = True
        await socket.send_json_to({'type': 'spectator_ping'})
        self.assertEqual(await socket.receive_json_from(),
                         {'type': 'spectator_error', 'code': 'unavailable'})
        await socket.disconnect()

    async def test_heartbeat_recovers_a_dropped_final_match_event(self):
        with patch.object(SpectatorConsumer, 'RECONCILE_SECONDS', 0):
            socket, _ = await self.open_viewer()
            # Persisted final state changes without delivering any group event.
            self.snapshot['status'] = 'completed'
            self.snapshot['payload'].update(version=8, phase='game_over', winner='white')
            self.snapshot['meta']['matchScore']['white'] = 7
            await socket.send_json_to({'type': 'spectator_ping'})
            final = await socket.receive_json_from()
            self.assertEqual(final['type'], 'spectator_end')
            self.assertEqual(final['payload']['winner'], 'white')
            self.assertEqual(final['meta']['matchScore']['white'], 7)
            self.assertEqual(self.revision_loader.call_count, 1)
            self.assertEqual(self.snapshot_loader.call_count, 2)
            await socket.disconnect()
            self.assertFalse(self.pool.owners[str(self.room_id)])

    async def test_unchanged_reconciliation_does_not_reload_full_snapshot(self):
        with patch.object(SpectatorConsumer, 'RECONCILE_SECONDS', 0):
            socket, _ = await self.open_viewer()
            await socket.send_json_to({'type': 'spectator_ping'})
            pong = await socket.receive_json_from()
            self.assertEqual(pong['type'], 'spectator_pong')
            self.assertEqual(self.revision_loader.call_count, 1)
            self.assertEqual(self.snapshot_loader.call_count, 1)
            await socket.disconnect()

    async def test_regular_ping_does_not_read_match_before_reconciliation_deadline(self):
        socket, _ = await self.open_viewer()
        await socket.send_json_to({'type': 'spectator_ping'})
        self.assertEqual((await socket.receive_json_from())['type'], 'spectator_pong')
        self.revision_loader.assert_not_called()
        self.assertEqual(self.snapshot_loader.call_count, 1)
        await socket.disconnect()


@skipUnless(os.environ.get('SPECTATOR_TEST_REDIS_URL'), 'Requires an explicit disposable test Redis')
class SpectatorRedisLimitTests(SimpleTestCase):
    async def test_concurrent_workers_share_two_slots_and_expired_owner_cannot_return(self):
        redis_url = os.environ['SPECTATOR_TEST_REDIS_URL']
        with override_settings(CHANNEL_LAYERS={'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [redis_url]},
        }}):
            room_id = uuid.uuid4()
            leases = [SpectatorLeases(room_id, str(uuid.uuid4())) for _ in range(4)]
            try:
                results = await asyncio.gather(*(lease.apply('reserve') for lease in leases[:3]))
                self.assertEqual(sum(results), 2)
                expired = leases[results.index(True)]
                await expired.client.zadd(expired.key, {expired.owner: 0})
                self.assertTrue(await leases[3].apply('reserve'))
                self.assertFalse(await expired.apply('renew'))
                await expired.apply('release')
                self.assertTrue(await leases[3].apply('valid'))
            finally:
                await leases[0].client.delete(leases[0].key)
                await asyncio.gather(*(lease.close() for lease in leases))
