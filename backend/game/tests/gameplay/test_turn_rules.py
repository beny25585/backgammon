"""Pure-engine regressions for obligations shared by every game format."""

from copy import deepcopy
from time import perf_counter
from unittest import TestCase

from game.engine import BackgammonEngine


class TurnRulesTests(TestCase):
    def position(self, white, black=None, dice=(2, 1), bar=0, color='white'):
        state = BackgammonEngine.get_initial_state()
        state.update(points=[0] * 24, phase='moving', turn='white',
                     dice=list(dice[:2]), remaining=list(dice),
                     lastMove=[], moveHistory=[])
        for point, count in white.items():
            state['points'][point] = count
        for point, count in (black or {}).items():
            state['points'][point] = -count
        state['bar']['white'] = bar
        state['home']['white'] = 15 - sum(white.values()) - bar
        state['home']['black'] = 15 - sum((black or {}).values())
        if color == 'black':
            state['points'] = [-count for count in reversed(state['points'])]
            state['bar'] = dict(white=state['bar']['black'], black=state['bar']['white'])
            state['home'] = dict(white=state['home']['black'], black=state['home']['white'])
            state['turn'] = 'black'
        return BackgammonEngine(state)

    def test_must_use_both_dice_before_bearing_off_last_checker(self):
        for color, source, destination in [('white', 1, 0), ('black', 22, 23)]:
            with self.subTest(color=color):
                engine = self.position({1: 1}, color=color)
                before = deepcopy(engine.state)
                self.assertFalse(engine.make_move(source, 'off', color)['success'])
                self.assertEqual(engine.state, before)
                self.assertEqual(engine.legal_moves_from(source, color),
                                 [{'from': source, 'to': destination, 'die': 1}])
                self.assertTrue(engine.make_move(source, destination, color)['success'])
                self.assertTrue(engine.make_move(destination, 'off', color)['success'])
                self.assertEqual(engine.state['winner'], color)

    def test_higher_die_when_only_one_can_be_used(self):
        engine = self.position({3: 1}, {0: 2}, dice=(1, 2))
        self.assertEqual(engine.all_legal_moves('white'), [{'from': 3, 'to': 1, 'die': 2}])
        before = deepcopy(engine.state)
        self.assertFalse(engine.make_move(3, 2, 'white')['success'])
        self.assertEqual(engine.state, before)
        self.assertTrue(engine.make_move(3, 1, 'white')['success'])
        self.assertEqual(engine.state['turn'], 'black')

    def test_lower_die_allowed_when_higher_is_blocked(self):
        engine = self.position({}, {22: 2, 21: 2}, dice=(2, 1), bar=1)
        self.assertEqual(engine.all_legal_moves('white'), [{'from': 'bar', 'to': 23, 'die': 1}])
        self.assertTrue(engine.make_move('bar', 23, 'white')['success'])

    def test_bar_entry_obeys_higher_die_and_bar_priority(self):
        engine = self.position({5: 1}, {21: 2, 4: 2, 3: 2}, dice=(1, 2), bar=1)
        self.assertEqual(engine.legal_moves_from(5, 'white'), [])
        self.assertEqual(engine.all_legal_moves('white'), [{'from': 'bar', 'to': 22, 'die': 2}])

    def test_bearoff_ambiguity_cannot_bypass_high_die_by_reordering(self):
        engine = self.position({0: 1}, dice=(1, 2))
        self.assertEqual(engine.legal_moves_from(0, 'white'), [{'from': 0, 'to': 'off', 'die': 2}])
        self.assertTrue(engine.reorder_dice('white')['success'])
        self.assertTrue(engine.make_move(0, 'off', 'white')['success'])
        self.assertEqual(engine.state['remaining'], [1])

    def test_equivalent_bearoff_choices_preserve_requested_dice_order(self):
        for dice in [(1, 2), (2, 1)]:
            engine = self.position({0: 2}, dice=dice)
            self.assertEqual([m['die'] for m in engine.legal_moves_from(0, 'white')], list(dice))
            self.assertTrue(engine.make_move(0, 'off', 'white')['success'])
            self.assertEqual(engine.state['remaining'], [dice[1]])

    def test_doubles_require_all_four_moves_when_available(self):
        engine = self.position({8: 1}, dice=(2, 2, 2, 2))
        for source in [8, 6, 4, 2]:
            self.assertFalse(engine.end_turn()['success'])
            self.assertTrue(engine.make_move(source, source - 2, 'white')['success'])
        self.assertTrue(engine.end_turn()['success'])
        self.assertEqual(engine.state['turn'], 'black')

    def test_partly_blocked_double_uses_every_available_move(self):
        engine = self.position({}, {20: 2}, dice=(2, 2, 2, 2), bar=2)
        self.assertTrue(engine.make_move('bar', 22, 'white')['success'])
        self.assertFalse(engine.end_turn()['success'])
        self.assertTrue(engine.make_move('bar', 22, 'white')['success'])
        self.assertEqual(engine.state['turn'], 'black')
        self.assertEqual(engine.state['remaining'], [])

    def test_end_turn_accepts_fully_blocked_turn(self):
        engine = self.position({}, {22: 2, 23: 2}, bar=1)
        self.assertTrue(engine.end_turn()['success'])
        self.assertEqual(engine.state['phase'], 'rolling')

    def test_roll_automatically_passes_fully_blocked_turn(self):
        engine = self.position({}, {22: 2, 23: 2}, bar=1)
        engine.state['phase'] = 'rolling'
        result = engine.roll_dice((1, 2))
        self.assertTrue(result['success'])
        self.assertEqual(result['turn_notice']['kind'], 'no_moves')
        self.assertEqual(engine.state['turn'], 'black')

    def test_make_move_and_end_turn_reject_wrong_phase_without_mutation(self):
        for phase in ['opening_roll', 'opening_result', 'rolling', 'doubling_offered', 'game_over']:
            engine = self.position({5: 1})
            engine.state['phase'] = phase
            before = deepcopy(engine.state)
            self.assertFalse(engine.make_move(5, 3, 'white')['success'])
            self.assertFalse(engine.end_turn()['success'])
            self.assertEqual(engine.state, before)

    def test_wrong_player_and_invalid_sources_do_not_mutate(self):
        engine = self.position({5: 1})
        before = deepcopy(engine.state)
        self.assertFalse(engine.make_move(5, 3, 'black')['success'])
        for source in ['bar', -1, 24, None, 'invalid']:
            self.assertFalse(engine.make_move(source, 3, 'white')['success'])
        self.assertEqual(engine.state, before)

    def test_undo_restores_turn_obligations(self):
        engine = self.position({1: 1})
        expected = engine.all_legal_moves('white')
        self.assertTrue(engine.make_move(1, 0, 'white')['success'])
        self.assertTrue(engine.undo_move()['success'])
        self.assertEqual(engine.state['remaining'], [2, 1])
        self.assertEqual(engine.all_legal_moves('white'), expected)
        self.assertFalse(engine.make_move(1, 'off', 'white')['success'])

    def test_search_does_not_modify_state_or_history_and_keeps_valid_orders(self):
        engine = self.position({5: 1}, dice=(2, 1))
        before = deepcopy(engine.state)
        self.assertEqual(engine.all_legal_moves('white'),
                         [{'from': 5, 'to': 3, 'die': 2}, {'from': 5, 'to': 4, 'die': 1}])
        self.assertEqual(engine.state, before)

    def test_hit_continuation_is_searchable_without_mutation(self):
        engine = self.position({3: 1}, {2: 1}, dice=(1, 2))
        before = deepcopy(engine.state)
        self.assertIn({'from': 3, 'to': 2, 'die': 1}, engine.all_legal_moves('white'))
        self.assertEqual(engine.state, before)
        self.assertTrue(engine.make_move(3, 2, 'white')['success'])
        self.assertEqual(engine.state['bar']['black'], 1)

    def test_all_initial_rolls_fit_a_generous_search_budget(self):
        start = perf_counter()
        for first in range(1, 7):
            for second in range(first, 7):
                state = BackgammonEngine.get_initial_state()
                state['remaining'] = BackgammonEngine._ordered_dice(first, second)
                self.assertTrue(BackgammonEngine(state).all_legal_moves('white'))
        self.assertLess(perf_counter() - start, 5.0)
