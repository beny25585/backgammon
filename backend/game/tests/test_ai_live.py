"""Optional contract tests against the actual upstream bgsage installation."""
import copy
import importlib.util
import random
from unittest import skipUnless

from django.test import SimpleTestCase
from game.ai import executable_turn, native_board
from game.engine import BackgammonEngine


@skipUnless(importlib.util.find_spec('bgsage'), 'Install pinned bgsage to run live engine contract tests')
class OpenSageGameContractTests(SimpleTestCase):
    def test_three_complete_games_against_our_rules(self):
        from bgsage import BgBotAnalyzer
        sage = BgBotAnalyzer(eval_level='1ply', cubeful=True, parallel_threads=1)
        rng = random.Random(20260919)
        turns = 0
        for game in range(3):
            engine = BackgammonEngine()
            engine.state.update(phase='rolling', turn='white', doublingEnabled=False)
            for turn in range(1000):
                color = engine.state['turn']
                a, b = rng.randint(1, 6), rng.randint(1, 6)
                self.assertTrue(engine.roll_dice(dice=(a, b))['success'])
                if engine.state['turn'] != color:
                    continue
                result = sage.checker_play(native_board(engine.state, color), a, b,
                    away1=1, away2=1, is_crawford=True, jacoby=False, beaver=False)
                target = list(result.moves[0].board)
                intents = executable_turn(engine.state, target)
                for intent in intents:
                    if intent['action'] == 'reorder_dice':
                        self.assertTrue(engine.reorder_dice(color)['success'])
                    else:
                        self.assertTrue(engine.make_move(intent['from'], intent['to'], color)['success'])
                self.assertEqual(native_board(engine.state, color), target)
                turns += 1
                if engine.state['phase'] == 'game_over':
                    break
                if engine.state['turn'] == color:
                    self.assertTrue(engine.end_turn()['success'])
            else:
                self.fail('Game did not finish')
            self.assertEqual(engine.state['home'][engine.state['winner']], 15)
        self.assertGreater(turns, 50)
