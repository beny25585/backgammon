from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase, TestCase

from game.engine import BackgammonEngine
from game.formats import apply_ticket, carry_contract, forfeit_win_type
from game.game_service import _points_for
from game.consumers import GameConsumer
from game.models import GameRoom, GameState
from game.link.models import TournamentLink
from game.link.outbox import build_result_body
from game.link.tests import link_settings, make_ticket
from game.link.signing import verify_ticket, TicketError


class FormatEngineTests(SimpleTestCase):
    def state(self, name='match', **kwargs):
        state = BackgammonEngine.get_initial_state()
        ticket = dict(format=name, cube_max=8, jacoby=name == 'money', stake='100.00',
                      loss_limit='800.00' if name == 'money' else '100.00', dbl=True, tp=5 if name == 'match' else 1)
        ticket.update(kwargs)
        apply_ticket(state, ticket)
        return state

    def test_crawford_once_then_cube_returns(self):
        previous = self.state()
        room = SimpleNamespace(target_points=5, white_score=4, black_score=0)
        fresh = BackgammonEngine.get_initial_state()
        carry_contract(previous, fresh, room)
        self.assertTrue(fresh['crawfordGame'])
        self.assertFalse(fresh['doublingEnabled'])
        fresh.update(phase='rolling', turn='white')
        self.assertFalse(BackgammonEngine(fresh).offer_double('white')['success'])
        next_state = BackgammonEngine.get_initial_state()
        carry_contract(fresh, next_state, room)
        self.assertFalse(next_state['crawfordGame'])
        self.assertTrue(next_state['crawfordUsed'])
        self.assertTrue(next_state['doublingEnabled'])
        self.assertEqual(next_state['stake'], '100.00')

    def test_one_point_match_and_no_cube_contract(self):
        self.assertFalse(self.state(tp=1)['doublingEnabled'])
        state = self.state(dbl=False)
        fresh = BackgammonEngine.get_initial_state()
        carry_contract(state, fresh, SimpleNamespace(target_points=5, white_score=1, black_score=0))
        self.assertFalse(fresh['doublingEnabled'])

    def test_max_cube_and_turn_are_enforced(self):
        state = self.state('money')
        state.update(cube=4, phase='rolling', turn='white')
        engine = BackgammonEngine(state)
        self.assertFalse(engine.offer_double('black')['success'])
        self.assertTrue(engine.offer_double('white')['success'])
        self.assertTrue(engine.respond_to_double(True, 'black')['success'])
        self.assertEqual(state['cube'], 8)
        state.update(turn='black', phase='rolling')
        self.assertFalse(engine.offer_double('black')['success'])

    def test_jacoby_does_not_change_match_scoring(self):
        state = self.state('money')
        self.assertEqual(_points_for(state, 'backgammon'), 1)
        state['cube'] = 2
        self.assertEqual(_points_for(state, 'backgammon'), 6)
        state = self.state()
        self.assertEqual(_points_for(state, 'backgammon'), 3)

    def test_leaving_does_not_avoid_current_win_multiplier(self):
        state = self.state('money')
        state['cube'] = 2
        self.assertEqual(forfeit_win_type(state, 'white'), 'backgammon')
        state['points'] = [0] * 24
        self.assertEqual(forfeit_win_type(state, 'white'), 'gammon')
        state['home']['white'] = 1
        self.assertEqual(forfeit_win_type(state, 'white'), 'single')

    def test_undo_clone_retains_signed_contract(self):
        state = self.state('money')
        cloned = BackgammonEngine._clone_state(state)
        for key in ('gameFormat', 'maxCube', 'jacoby', 'stake', 'lossLimit'):
            self.assertEqual(cloned[key], state[key])

    def test_client_cannot_choose_paid_result(self):
        consumer = GameConsumer()
        consumer.room_id = 'test-room'
        consumer._send_error = AsyncMock()
        consumer._finalize_and_broadcast = AsyncMock()
        with patch('game.consumers.get_room', AsyncMock(return_value=object())), patch(
            'game.consumers.get_game_state', AsyncMock(return_value=SimpleNamespace(state_data=self.state('money')))):
            async_to_sync(consumer._handle_game_ended)({'winner': 'white', 'cube': 64, 'winType': 'backgammon'})
        consumer._send_error.assert_awaited_once()
        consumer._finalize_and_broadcast.assert_not_awaited()


class FinancialResultTests(TestCase):
    @link_settings
    def test_signed_format_provisions_both_state_copies(self):
        ticket = make_ticket(format='money', cube_max=4, jacoby=True, stake='100.00', loss_limit='800.00', tp=1)
        response = self.client.get('/api/link/enter/', {'ticket': ticket})
        self.assertEqual(response.status_code, 302)
        room = GameRoom.objects.get()
        saved = GameState.objects.get(room=room).state_data
        for state in (room.state, saved):
            self.assertEqual(state['gameFormat'], 'money')
            self.assertEqual(state['maxCube'], 4)
            self.assertEqual(state['lossLimit'], '800.00')

    @link_settings
    def test_incompatible_signed_contract_is_rejected(self):
        for changes in ({'tp': 5}, {'cube_max': 3}, {'loss_limit': 'NaN'}, {'jacoby': 'false'}):
            data = dict(format='money', cube_max=8, jacoby=True, stake='100.00', loss_limit='800.00', tp=1)
            data.update(changes)
            with self.assertRaises(TicketError):
                verify_ticket(make_ticket(**data))

    def test_outbox_carries_authoritative_financial_result(self):
        initial = BackgammonEngine.get_initial_state()
        initial.update(gameFormat='money', cube=4, winType='gammon')
        room = GameRoom.objects.create(code='MONEY1', target_points=1, state=initial)
        GameState.objects.create(room=room, state_data=initial)
        link = TournamentLink.objects.create(issuer='tournaments', fixture_id=-1, tournament_id=0, room=room)
        body = build_result_body(link, room, winner_color='white', end_reason='bear_off')
        self.assertEqual(body['financial_result'], dict(format='money', cube=4, win_type='gammon'))
