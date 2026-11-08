import copy
import time
import uuid
from datetime import timedelta

from django.contrib.auth.models import User
from django.core import signing
from django.test import TestCase, override_settings
from django.utils import timezone

from game.ai import (
    BotLeaseLost,
    BotStateChanged,
    claim,
    claim_bot,
    executable_turn,
    native_board,
    release,
)
from game.engine import BackgammonEngine
from game.event_history import persist_game_action
from game.models import AiSession, GameRoom, GameState, Player, RoomPlayer
from game.presence import check_room_presence


class PracticeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('practice-human')
        self.player, _ = Player.objects.get_or_create(user=self.user)
        self.room = GameRoom.objects.create(code='AIPLAY', status='playing', target_points=1,
            time_control='none', state={'ai': {'difficulty': 'hard'}})
        self.session = AiSession.objects.create(room=self.room)
        RoomPlayer.objects.create(room=self.room, player=self.player, color='white')

    def test_cross_connection_lease(self):
        first = claim(self.room.id)
        self.assertTrue(first)
        self.assertIsNone(claim(self.room.id))
        release(self.room.id, 'not-the-owner')
        self.assertIsNone(claim(self.room.id))
        release(self.room.id, first)
        self.assertTrue(claim(self.room.id))

    def test_stale_bot_attempt_cannot_persist_handoff_or_release_current_lease(self):
        state = BackgammonEngine.get_initial_state()
        state.update(turn='black', phase='moving', dice=[3, 1], remaining=[])
        GameState.objects.create(room=self.room, state_data=state)
        version = persist_game_action(self.room.pk, state, 'black', 'move')
        previous_lease = claim(self.room.pk)
        self.assertIsNotNone(previous_lease)
        AiSession.objects.filter(pk=self.session.pk).update(lease_until=timezone.now() - timedelta(seconds=1))
        current_lease = claim(self.room.pk)
        self.assertIsNotNone(current_lease)
        self.assertNotEqual(current_lease, previous_lease)

        engine = BackgammonEngine(copy.deepcopy(state))
        self.assertTrue(engine.end_turn()['success'])
        for lease, expected_version, error in (
            (previous_lease, version, BotLeaseLost), (current_lease, version - 1, BotStateChanged),
        ):
            with self.subTest(expected_version=expected_version), self.assertRaises(error):
                persist_game_action(self.room.pk, engine.state, 'black', 'end_turn',
                    bot_lease=lease, expected_version=expected_version)
        release(self.room.pk, previous_lease)
        self.session.refresh_from_db()
        self.assertEqual(self.session.lease_token, current_lease)
        self.assertEqual(GameState.objects.get(room=self.room).state_data, state)
        self.assertEqual(list(self.room.events.values_list('sequence', flat=True)), [version])

        self.assertEqual(persist_game_action(self.room.pk, engine.state, 'black', 'end_turn',
            bot_lease=current_lease, expected_version=version), version + 1)
        self.session.refresh_from_db()
        self.assertEqual(self.session.lease_token, '')
        self.assertIsNone(claim_bot(self.room.pk))
        self.assertIsNotNone(claim(self.room.pk))


    def test_ai_is_not_forfeited_for_absent_bot_socket(self):
        self.assertEqual(check_room_presence(self.room.id)['status'], 'practice')

    def test_complete_turn_and_partial_resume(self):
        for color in ('white', 'black'):
            state = BackgammonEngine.get_initial_state()
            state.update(turn=color, phase='moving', dice=[3, 1], remaining=[3, 1])
            engine = BackgammonEngine(copy.deepcopy(state))
            while engine.state['remaining'] and engine.state['phase'] == 'moving' and engine.state['turn'] == color:
                move = engine.all_legal_moves(color)[0]
                engine.make_move(move['from'], move['to'], color)
            target = native_board(engine.state, color)
            intents = executable_turn(state, target)
            current = BackgammonEngine(copy.deepcopy(state))
            for intent in intents:
                if intent['action'] == 'reorder_dice':
                    current.reorder_dice(color)
                else:
                    self.assertTrue(current.make_move(intent['from'], intent['to'], color)['success'])
                # Saved final board supports a process restart after any step.
                executable_turn(current.state, target) if current.state['turn'] == color else None
            self.assertEqual(native_board(current.state, color), target)
            with self.assertRaises(ValueError):
                executable_turn(state, [0] * 26)



    @override_settings(GAMELINK_ENABLED=True, GAMELINK_TICKET_SECRETS=['test-key'],
        GAMELINK_ACCEPTED_ISSUERS=['club'], GAMELINK_ISSUER='game',
        AI_SERVICE_URL='http://analysis.test', ANALYSIS_API_TOKEN='test-token',
        GAMELINK_FRONTEND_URL='https://game.test/backgammon',
        GAMELINK_TOURNAMENTS_FRONTEND_URL='https://club.test')
    def test_entry_single_use_identity_and_resume(self):
        from game.link.models import LinkedIdentity
        external = str(uuid.uuid4())
        purchase_id = str(uuid.uuid4())
        room_id = None
        def issue(purpose='enter'):
            return signing.dumps({'v': 1, 'iss': 'club', 'aud': 'game',
                'jti': str(uuid.uuid4()), 'sub': external, 'name': 'Practice user',
                'exp': int(time.time()) + 60, 'difficulty': 'medium',
                'purpose': purpose, 'purchase_id': purchase_id, 'room_id': room_id,
                'tp': 5, 'tc': 'fast', 'dbl': True},
                key='test-key', salt='gamelink.practice.v1')
        prepared = self.client.post('/api/link/practice/prepare/', {'ticket': issue('prepare')})
        self.assertEqual(prepared.status_code, 200)
        room_id = prepared.json()['room_id']
        self.assertEqual(GameRoom.objects.get(pk=room_id).status, 'waiting')
        self.assertEqual(
            self.client.post('/api/link/practice/status/', {'ticket': issue('status')}).json(),
            {'active': True},
        )
        self.assertEqual(self.client.get('/api/link/practice/', {'ticket': issue('prepare')}).status_code, 400)
        repeated = self.client.post('/api/link/practice/prepare/', {'ticket': issue('prepare')})
        self.assertEqual(repeated.json()['room_id'], room_id)
        token = issue()
        response = self.client.get('/api/link/practice/', {'ticket': token})
        self.assertEqual(response.status_code, 302)
        self.assertIn('practice=1', response['Location'])
        self.assertEqual(self.client.get('/api/link/practice/', {'ticket': token}).status_code, 409)
        identity = LinkedIdentity.objects.get(issuer='club', external_id=external)
        room = GameRoom.objects.get(players__player__user=identity.user)
        self.assertEqual(room.ai_session.difficulty, 'medium')
        self.assertTrue(GameState.objects.get(room=room).state_data['doublingEnabled'])
        self.assertEqual((room.target_points, room.time_control, room.status), (5, 'fast', 'playing'))
        self.assertEqual(self.client.get('/api/link/practice/', {'ticket': issue()}).status_code, 302)
        self.assertEqual(GameRoom.objects.filter(players__player__user=identity.user).count(), 1)
        room.status = 'completed'
        room.save(update_fields=['status'])
        self.assertEqual(
            self.client.post('/api/link/practice/status/', {'ticket': issue('status')}).json(),
            {'active': False},
        )
