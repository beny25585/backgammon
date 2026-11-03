import asyncio
import copy
import json
import os
import uuid
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import AsyncMock, patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase, override_settings

from game.ai_consumer import PracticeGameConsumer
from game.consumers import GameConsumer
from game.models import GameEvent, GameRoom, GameState, Player, RoomPlayer, Task
from game.reactions import (
    REACTION_COOLDOWN_MS, REACTION_DURATION_MS, ReactionError,
    create_player_reaction, get_reaction_sender, reserve_reaction_cooldown,
)
from game.room_execution import room_operation
from game.spectator_consumer import SpectatorConsumer


class ReactionMembershipTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='REACT1', status='playing')
        self.white = User.objects.create_user('reaction-white')
        self.black = User.objects.create_user('reaction-black')
        for user, color in ((self.white, 'white'), (self.black, 'black')):
            RoomPlayer.objects.create(
                room=self.room, player=Player.objects.create(user=user), color=color,
            )
        GameState.objects.create(room=self.room, state_data={
            'phase': 'moving', 'clock': {'white': 120000, 'black': 120000},
            'turnStartedAt': 1000, 'inactivity': {'deadlineMs': 20000},
        })

    def sender(self, user_id=None, color='white'):
        return get_reaction_sender.__wrapped__(
            self.room.id, self.white.id if user_id is None else user_id, color,
        )

    def test_current_participant_can_react_without_any_gameplay_write(self):
        before_room = copy.deepcopy(self.room.state)
        before_state = copy.deepcopy(self.room.gamestate.state_data)
        before_updated = self.room.updated_at
        before_events = GameEvent.objects.count()
        before_tasks = Task.objects.count()
        self.assertEqual(self.sender(), 'white')
        self.room.refresh_from_db()
        self.room.gamestate.refresh_from_db()
        self.assertEqual(self.room.state, before_room)
        self.assertEqual(self.room.gamestate.state_data, before_state)
        self.assertEqual(self.room.updated_at, before_updated)
        self.assertEqual(GameEvent.objects.count(), before_events)
        self.assertEqual(Task.objects.count(), before_tasks)

    def test_unassigned_user_and_changed_seat_are_refused(self):
        self.assertIsNone(self.sender(self.black.id))
        RoomPlayer.objects.filter(room=self.room, color='white').delete()
        self.assertIsNone(self.sender())

    def test_waiting_and_finished_rooms_are_refused_on_fresh_lookup(self):
        self.assertEqual(self.sender(), 'white')
        for status in ('waiting', 'completed', 'cancelled'):
            with self.subTest(status=status):
                GameRoom.objects.filter(pk=self.room.pk).update(status=status)
                self.assertIsNone(self.sender())

    def test_practice_and_paused_rooms_are_refused(self):
        for state in (
            {'ai': {'difficulty': 'hard'}},
            {'presence': {'needsAdminAdjudication': True}},
        ):
            with self.subTest(state=state):
                GameRoom.objects.filter(pk=self.room.pk).update(state=state)
                self.assertIsNone(self.sender())

    def test_missing_room_is_refused(self):
        self.room.delete()
        self.assertIsNone(self.sender())


class ReactionCreationTests(SimpleTestCase):
    def setUp(self):
        self.room_id = str(uuid.uuid4())

    async def test_forged_sender_room_and_expiry_are_ignored(self):
        with patch('game.reactions.get_reaction_sender', AsyncMock(return_value='white')), \
                patch('game.reactions.reserve_reaction_cooldown', AsyncMock(return_value=0)), \
                patch('game.reactions.time.time', return_value=100):
            reaction = await create_player_reaction(self.room_id, 7, 'white', {
                'reactionId': 'nice_move', 'color': 'black', 'roomId': 'other',
                'expiresAt': 9000000, 'remainingMs': 9000000,
            })
        self.assertEqual(reaction['roomId'], self.room_id)
        self.assertEqual(reaction['color'], 'white')
        self.assertEqual(reaction['reactionId'], 'nice_move')
        self.assertEqual(reaction['expiresAt'], 104000)
        self.assertEqual(reaction['remainingMs'], REACTION_DURATION_MS)
        self.assertEqual(reaction['cooldownMs'], REACTION_COOLDOWN_MS)
        uuid.UUID(reaction['id'])

    async def test_free_text_unknown_ids_and_malformed_payloads_are_refused(self):
        with patch('game.reactions.get_reaction_sender', AsyncMock()) as sender, \
                patch('game.reactions.reserve_reaction_cooldown', AsyncMock()) as reserve:
            for payload in (None, [], 'hello', {}, {'reactionId': []},
                            {'reactionId': 'arbitrary text'}, {'reactionId': '💥'}):
                with self.subTest(payload=payload), self.assertRaises(ReactionError) as raised:
                    await create_player_reaction(self.room_id, 7, 'white', payload)
                self.assertEqual(raised.exception.reason, 'invalid')
        sender.assert_not_awaited()
        reserve.assert_not_awaited()

    async def test_membership_failure_does_not_reserve_cooldown(self):
        with patch('game.reactions.get_reaction_sender', AsyncMock(return_value=None)), \
                patch('game.reactions.reserve_reaction_cooldown', AsyncMock()) as reserve:
            with self.assertRaises(ReactionError) as raised:
                await create_player_reaction(self.room_id, 7, 'white', {'reactionId': 'smile'})
        self.assertEqual(raised.exception.reason, 'unavailable')
        reserve.assert_not_awaited()

    async def test_cooldown_returns_the_remaining_server_wait(self):
        with patch('game.reactions.get_reaction_sender', AsyncMock(return_value='white')), \
                patch('game.reactions.reserve_reaction_cooldown', AsyncMock(return_value=1250)):
            with self.assertRaises(ReactionError) as raised:
                await create_player_reaction(self.room_id, 7, 'white', {'reactionId': 'smile'})
        self.assertEqual(raised.exception.reason, 'cooldown')
        self.assertEqual(raised.exception.retry_after_ms, 1250)


class ReactionConsumerTests(SimpleTestCase):
    def setUp(self):
        self.consumer = GameConsumer()
        self.consumer.room_id = str(uuid.uuid4())
        self.consumer.room_group_name = f'game_{self.consumer.room_id}'
        self.consumer.user_id = 7
        self.consumer.player_color = 'white'
        self.consumer.send = AsyncMock()
        self.consumer.channel_layer = SimpleNamespace(group_send=AsyncMock())
        self.payload = {
            'id': str(uuid.uuid4()), 'roomId': self.consumer.room_id,
            'reactionId': 'smile', 'color': 'white', 'expiresAt': 104000,
            'remainingMs': 4000, 'cooldownMs': 3000,
        }

    async def send_reaction(self, payload=None):
        await self.consumer.receive(json.dumps({
            'type': 'player_reaction',
            'payload': {'reactionId': 'smile'} if payload is None else payload,
        }))

    async def test_reaction_does_not_enter_gameplay_dispatch_or_room_lock(self):
        # A blocked gameplay operation must not stop an ephemeral reaction.
        async with room_operation(self.consumer.room_id):
            with patch('game.consumers.create_player_reaction',
                       AsyncMock(return_value=self.payload)) as create, \
                    patch.object(self.consumer, '_receive_gameplay', AsyncMock()) as gameplay:
                await asyncio.wait_for(asyncio.create_task(self.send_reaction()), timeout=0.5)
        create.assert_awaited_once_with(
            self.consumer.room_id, 7, 'white', {'reactionId': 'smile'},
        )
        gameplay.assert_not_awaited()
        self.consumer.channel_layer.group_send.assert_awaited_once_with(
            self.consumer.room_group_name, {'type': 'player_reaction', 'payload': self.payload},
        )
        self.consumer.send.assert_not_awaited()

    async def test_cooldown_has_separate_error_envelope_without_broadcast(self):
        with patch('game.consumers.create_player_reaction', AsyncMock(
            side_effect=ReactionError('cooldown', retry_after_ms=1200),
        )):
            await self.send_reaction()
        self.assertEqual(json.loads(self.consumer.send.call_args.args[0]), {
            'type': 'player_reaction_error',
            'payload': {'reason': 'cooldown', 'retryAfterMs': 1200,
                        'roomId': self.consumer.room_id},
        })
        self.consumer.channel_layer.group_send.assert_not_awaited()

    async def test_redis_failure_does_not_raise_a_gameplay_error(self):
        with patch('game.consumers.create_player_reaction',
                   AsyncMock(side_effect=ConnectionError('Redis unavailable'))), \
                self.assertLogs('game.consumers', level='ERROR'):
            await self.send_reaction()
        self.assertEqual(json.loads(self.consumer.send.call_args.args[0]), {
            'type': 'player_reaction_error',
            'payload': {'reason': 'unavailable', 'roomId': self.consumer.room_id},
        })
        self.consumer.channel_layer.group_send.assert_not_awaited()

    async def test_delivery_uses_remaining_lifetime_instead_of_restarting_it(self):
        with patch('game.consumers.time_module.time', return_value=102.5):
            await self.consumer.player_reaction({'payload': self.payload})
        delivered = json.loads(self.consumer.send.call_args.args[0])
        self.assertEqual(delivered['type'], 'player_reaction')
        self.assertEqual(delivered['payload']['remainingMs'], 1500)
        self.assertEqual(delivered['payload']['expiresAt'], 104000)

    async def test_expired_or_other_room_reactions_are_dropped(self):
        with patch('game.consumers.time_module.time', return_value=104):
            await self.consumer.player_reaction({'payload': self.payload})
        await self.consumer.player_reaction({
            'payload': {**self.payload, 'roomId': str(uuid.uuid4())},
        })
        self.consumer.send.assert_not_awaited()

    async def test_spectator_does_not_receive_player_reactions(self):
        spectator = SpectatorConsumer()
        spectator.send = AsyncMock()
        await spectator.dispatch({'type': 'player_reaction', 'payload': self.payload})
        spectator.send.assert_not_awaited()

    async def test_practice_rejection_does_not_acquire_bot_lease_or_change_gameplay(self):
        consumer = PracticeGameConsumer()
        consumer.room_id = self.consumer.room_id
        consumer.user_id = 7
        consumer.player_color = 'white'
        consumer.is_ai = True
        consumer.send = AsyncMock()
        with patch('game.consumers.create_player_reaction',
                   AsyncMock(side_effect=ReactionError('unavailable'))), \
                patch('game.ai_consumer.ai.claim', AsyncMock()) as claim:
            await consumer.receive(json.dumps({
                'type': 'player_reaction', 'payload': {'reactionId': 'smile'},
            }))
        claim.assert_not_awaited()
        self.assertEqual(json.loads(consumer.send.call_args.args[0]), {
            'type': 'player_reaction_error',
            'payload': {'reason': 'unavailable', 'roomId': consumer.room_id},
        })


class ReactionCooldownFailureTests(SimpleTestCase):
    @override_settings(CHANNEL_LAYERS={
        'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
    })
    async def test_process_local_channel_layer_never_silently_weakens_cooldown(self):
        with self.assertRaises(ReactionError) as raised:
            await reserve_reaction_cooldown(uuid.uuid4(), 7)
        self.assertEqual(raised.exception.reason, 'unavailable')

    async def test_failed_redis_request_releases_its_connection(self):
        client = SimpleNamespace(
            eval=AsyncMock(side_effect=ConnectionError('unavailable')),
            close=AsyncMock(),
        )
        with patch('game.reactions._cooldown_client', return_value=(client, 'test')):
            with self.assertRaises(ConnectionError):
                await reserve_reaction_cooldown(uuid.uuid4(), 7)
        client.close.assert_awaited_once()


@skipUnless(os.environ.get('PLAYER_REACTION_TEST_REDIS_URL'), 'Dedicated Redis URL required')
class SharedReactionCooldownTests(SimpleTestCase):
    async def test_two_workers_or_tabs_share_one_atomic_cooldown(self):
        # Each call opens its own Redis client, as separate workers would.
        room_id = uuid.uuid4()
        settings = {'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [os.environ['PLAYER_REACTION_TEST_REDIS_URL']]},
        }}
        with override_settings(CHANNEL_LAYERS=settings):
            results = await asyncio.gather(
                reserve_reaction_cooldown(room_id, 7),
                reserve_reaction_cooldown(room_id, 7),
            )
            self.assertEqual(sum(value == 0 for value in results), 1)
            blocked = max(results)
            self.assertGreater(blocked, 0)
            self.assertLessEqual(blocked, REACTION_COOLDOWN_MS)
            self.assertEqual(await reserve_reaction_cooldown(room_id, 8), 0)
            self.assertEqual(await reserve_reaction_cooldown(uuid.uuid4(), 7), 0)
