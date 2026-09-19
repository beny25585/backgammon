import copy
import time
import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import signing
from django.test import TestCase, override_settings

from game.ai import claim, release, native_board, executable_turn
from game.engine import BackgammonEngine
from game.models import AiSession, GameRoom, GameState, Match, Player, RoomPlayer
from game.game_service import record_game_end
from game.link.practice import verify_practice_ticket
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

    def test_match_scoring_crawford_and_clock_carry_between_games(self):
        from asgiref.sync import async_to_sync
        from game.ai_consumer import PracticeGameConsumer
        from game.clock import parse_time_control
        self.room.target_points = 5
        self.room.white_score = 3
        self.room.time_control = 'fast'
        self.room.save()
        state = BackgammonEngine.get_initial_state()
        state.update(phase='game_over', winner='white', winType='single', cube=1,
            gameFormat='match', doublingAllowed=True, doublingEnabled=True,
            crawfordGame=False, crawfordUsed=False, maxCube=64, clock={'white': 123000, 'black': 140000})
        GameState.objects.create(room=self.room, state_data=state)
        result = record_game_end(self.room, state, 'white', 'single', 'move')
        self.assertFalse(result['match_over'])
        engine = BackgammonEngine(GameState.objects.get(room=self.room).state_data)
        actor = PracticeGameConsumer()
        actor.room_id = str(self.room.id)
        self.assertTrue(async_to_sync(actor._handle_next_game)(engine)['success'])
        self.assertTrue(engine.state['crawfordGame'])
        self.assertFalse(engine.state['doublingEnabled'])
        self.assertEqual(engine.state['clock'], {'white': 123000, 'black': 140000})
        self.assertEqual(parse_time_control('fast', 5), (150000, 10000))
        from game.formats import carry_contract
        fresh = BackgammonEngine.get_initial_state()
        self.room.refresh_from_db()
        carry_contract(engine.state, fresh, self.room)
        self.assertTrue(fresh['doublingEnabled'])
        self.assertFalse(fresh['crawfordGame'])

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

    @patch('game.game_service.enqueue_match_analysis')
    def test_result_is_ai_and_belongs_to_human(self, enqueue):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='game_over', winner='white', winType='single')
        GameState.objects.create(room=self.room, state_data=state)
        record_game_end(self.room, state, 'white', 'single', 'move')
        match = Match.objects.get(room=self.room)
        self.assertEqual(match.match_type, 'ai')
        self.assertEqual(match.white_player_id, self.player.id)
        self.assertIsNone(match.black_player_id)

    @override_settings(GAMELINK_TICKET_SECRETS=['test-key'], GAMELINK_ACCEPTED_ISSUERS=['club'], GAMELINK_ISSUER='game')
    def test_ticket_scope_signature_and_expiry(self):
        payload = {'v': 1, 'iss': 'club', 'aud': 'game', 'jti': str(uuid.uuid4()),
            'sub': str(uuid.uuid4()), 'exp': int(time.time()) + 60, 'difficulty': 'hard',
            'purpose': 'enter', 'purchase_id': str(uuid.uuid4()), 'room_id': str(uuid.uuid4()),
            'tp': 5, 'tc': 'normal', 'dbl': True}
        token = signing.dumps(payload, key='test-key', salt='gamelink.practice.v1')
        self.assertEqual(verify_practice_ticket(token)['sub'], payload['sub'])
        for bad in (token + 'x', signing.dumps(payload, key='test-key', salt='gamelink.ticket.v1')):
            with self.assertRaises(ValueError):
                verify_practice_ticket(bad)
        payload['exp'] = int(time.time()) - 1
        with self.assertRaises(ValueError):
            verify_practice_ticket(signing.dumps(payload, key='test-key', salt='gamelink.practice.v1'))

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
