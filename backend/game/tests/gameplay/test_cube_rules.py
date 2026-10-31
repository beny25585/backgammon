"""Cube rules use the offerer's match score and never consume an unrolled turn."""

from copy import deepcopy
from unittest import TestCase

from game.engine import BackgammonEngine


class CubeRulesTests(TestCase):
    def engine(self, *, color='white', cube=1, game_format='match'):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='rolling', turn=color, cube=cube, maxCube=64)
        if game_format is not None:
            state['gameFormat'] = game_format
        return BackgammonEngine(state)

    def test_dead_cube_depends_on_points_needed_by_the_offerer(self):
        cases = [
            # A three-point match can reach four, but four cannot be redoubled.
            ('white', 3, {'white': 0, 'black': 0}, 2, True),
            ('white', 3, {'white': 0, 'black': 0}, 4, False),
            ('white', 3, {'white': 1, 'black': 0}, 2, False),
            # The opponent's score does not make the offerer's cube dead.
            ('black', 3, {'white': 2, 'black': 0}, 2, True),
            ('black', 3, {'white': 0, 'black': 1}, 2, False),
            ('white', 7, {'white': 4, 'black': 0}, 2, True),
            ('white', 7, {'white': 4, 'black': 0}, 4, False),
        ]
        for color, target, scores, cube, allowed in cases:
            with self.subTest(color=color, target=target, scores=scores, cube=cube):
                engine = self.engine(color=color, cube=cube)
                before = deepcopy(engine.state)
                self.assertEqual(engine.can_offer_double(
                    color, target_points=target, scores=scores,
                ), allowed)
                self.assertEqual(engine.state, before)
                result = engine.offer_double(color, target_points=target, scores=scores)
                self.assertEqual(result['success'], allowed)
                if allowed:
                    responder = 'black' if color == 'white' else 'white'
                    self.assertTrue(engine.respond_to_double(True, responder)['success'])
                    self.assertEqual(engine.state['cube'], cube * 2)
                else:
                    self.assertEqual(engine.state, before)

    def test_money_cube_ignores_match_target_and_score(self):
        engine = self.engine(cube=4, game_format='money')
        self.assertTrue(engine.offer_double(
            'white', target_points=1, scores={'white': 0, 'black': 0},
        )['success'])
        self.assertTrue(engine.respond_to_double(True, 'black')['success'])
        self.assertEqual(engine.state['cube'], 8)

    def test_unversioned_room_uses_known_match_context(self):
        engine = self.engine(cube=4, game_format=None)
        self.assertFalse(engine.offer_double(
            'white', target_points=3, scores={'white': 0, 'black': 0},
        )['success'])

    def test_missing_match_context_does_not_guess_a_score(self):
        engine = self.engine(cube=4, game_format=None)
        self.assertTrue(engine.offer_double('white')['success'])

    def test_crawford_game_cannot_be_doubled(self):
        engine = self.engine()
        engine.state.update(crawfordGame=True, doublingEnabled=True)
        self.assertFalse(engine.offer_double(
            'white', target_points=3, scores={'white': 0, 'black': 2},
        )['success'])

    def test_accepted_double_after_blocked_roll_requires_offerers_new_roll(self):
        for blocked in ('white', 'black'):
            with self.subTest(blocked=blocked):
                offerer = 'black' if blocked == 'white' else 'white'
                state = self.engine().state
                state['points'] = [0] * 24
                state['points'][5] = 14
                state['points'][0] = -11
                state['points'][22] = -2
                state['points'][23] = -2
                state['bar'] = {'white': 1, 'black': 0}
                if blocked == 'black':
                    state['points'] = [-count for count in reversed(state['points'])]
                    state['bar'] = {'white': 0, 'black': 1}
                state['turn'] = blocked
                engine = BackgammonEngine(state)
                result = engine.roll_dice((2, 1))
                self.assertTrue(result['success'])
                self.assertEqual(state['turn'], offerer)
                self.assertEqual(state['phase'], 'rolling')
                self.assertEqual(state['dice'], [2, 1])
                notice = deepcopy(result['turn_notice'])

                self.assertTrue(engine.offer_double(
                    offerer, target_points=5, scores={'white': 0, 'black': 0},
                )['success'])
                self.assertTrue(engine.respond_to_double(True, blocked)['success'])
                self.assertEqual(state['turn'], offerer)
                self.assertEqual(state['phase'], 'rolling')
                self.assertEqual(state['cube'], 2)
                self.assertEqual(state['cubeOwner'], blocked)
                self.assertEqual(state['dice'], [])
                self.assertEqual(state['remaining'], [])
                self.assertIsNone(state['lastMove'])
                self.assertIsNone(state['moveHistory'])
                self.assertEqual(result['turn_notice'], notice)
                self.assertFalse(engine.end_turn()['success'])
                self.assertFalse(engine.offer_double(
                    blocked, target_points=5, scores={'white': 0, 'black': 0},
                )['success'])
                self.assertTrue(engine.roll_dice((3, 1))['success'])
                self.assertEqual(state['turn'], offerer)
                self.assertEqual(state['phase'], 'moving')
                self.assertEqual(state['remaining'], [3, 1])
