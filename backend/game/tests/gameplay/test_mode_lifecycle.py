"""Signed format rules survive scoring and the transition between games."""
from django.test import TestCase

from game.engine import BackgammonEngine
from game.formats import apply_ticket, carry_contract
from game.game_service import record_game_end
from game.models import GameRoom, Match


class ModeLifecycleTests(TestCase):
    def make_room(self, game_format, target_points):
        state = BackgammonEngine.get_initial_state()
        apply_ticket(state, {
            'format': game_format, 'tp': target_points, 'dbl': True,
            'cube_max': 8 if game_format == 'money' else 64,
            'jacoby': game_format == 'money', 'stake': '100.00',
            'loss_limit': '800.00' if game_format == 'money' else '100.00',
        })
        room = GameRoom.objects.create(
            code='MODE01', target_points=target_points, status='playing', state=state,
        )
        return room, state

    def finish(self, room, state, winner, win_type):
        state.update(phase='game_over', winner=winner, winType=win_type)
        result = record_game_end(room, state, winner, win_type, 'bear_off')
        room.refresh_from_db()
        return result

    def next_game(self, room, previous, game_id):
        fresh = BackgammonEngine.get_initial_state()
        carry_contract(previous, fresh, room)
        fresh['gameId'] = game_id
        return fresh

    def test_money_closes_after_one_game_and_jacoby_limits_uncubed_score(self):
        room, state = self.make_room('money', 1)
        result = self.finish(room, state, 'white', 'backgammon')
        self.assertTrue(result['match_over'])
        self.assertEqual(room.status, 'completed')
        self.assertEqual(room.white_score, 1)
        self.assertEqual(Match.objects.get(room=room).games[0]['points_awarded'], 1)
        self.assertIsNone(self.finish(room, state, 'white', 'backgammon'))
        self.assertEqual(room.white_score, 1)

    def test_money_after_accepted_double_scores_the_win_multiplier(self):
        room, state = self.make_room('money', 1)
        state.update(phase='rolling', turn='white')
        engine = BackgammonEngine(state)
        self.assertTrue(engine.offer_double('white')['success'])
        self.assertTrue(engine.respond_to_double(True, 'black')['success'])
        result = self.finish(room, state, 'white', 'gammon')
        self.assertTrue(result['match_over'])
        self.assertEqual(room.white_score, 4)

    def test_match_continues_through_crawford_then_restores_cube(self):
        room, state = self.make_room('match', 5)
        state['cube'] = 2
        first = self.finish(room, state, 'white', 'gammon')
        self.assertFalse(first['match_over'])
        self.assertEqual(room.white_score, 4)
        self.assertFalse(Match.objects.filter(room=room).exists())

        crawford = self.next_game(room, state, 'crawford')
        self.assertTrue(crawford['crawfordGame'])
        crawford.update(phase='rolling', turn='black')
        self.assertFalse(BackgammonEngine(crawford).offer_double('black')['success'])
        second = self.finish(room, crawford, 'black', 'single')
        self.assertFalse(second['match_over'])

        post_crawford = self.next_game(room, crawford, 'post-crawford')
        self.assertFalse(post_crawford['crawfordGame'])
        self.assertTrue(post_crawford['crawfordUsed'])
        self.assertTrue(post_crawford['doublingEnabled'])
        self.assertEqual(post_crawford['maxCube'], 64)
        self.assertEqual(post_crawford['stake'], '100.00')
        self.assertEqual(post_crawford['lossLimit'], '100.00')
        third = self.finish(room, post_crawford, 'white', 'single')
        self.assertTrue(third['match_over'])
        self.assertEqual((room.white_score, room.black_score), (5, 1))
        self.assertEqual(len(Match.objects.get(room=room).games), 3)

    def test_match_cube_can_reach_64_but_cannot_exceed_it(self):
        _, state = self.make_room('match', 9)
        state.update(phase='rolling', turn='white', cube=32)
        engine = BackgammonEngine(state)
        self.assertTrue(engine.offer_double('white')['success'])
        self.assertTrue(engine.respond_to_double(True, 'black')['success'])
        self.assertEqual(state['cube'], 64)
        state.update(phase='rolling', turn='black')
        self.assertFalse(engine.offer_double('black')['success'])

    def test_drop_scores_cube_before_offer_and_finishes_money_game(self):
        room, state = self.make_room('money', 1)
        state.update(phase='rolling', turn='white', cube=2)
        engine = BackgammonEngine(state)
        self.assertTrue(engine.offer_double('white')['success'])
        self.assertTrue(engine.respond_to_double(False, 'black')['success'])
        self.assertEqual(state['winType'], 'single')
        self.assertEqual(state['cube'], 2)
        result = self.finish(room, state, state['winner'], state['winType'])
        self.assertTrue(result['match_over'])
        self.assertEqual(room.white_score, 2)
