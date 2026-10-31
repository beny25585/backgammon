"""A closed home board passes a barred player's turn without drawing dice."""

from copy import deepcopy
from time import perf_counter
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from django.test import SimpleTestCase

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.server_actions import apply_server_game_action


def closed_bar_state(color='white'):
    state = BackgammonEngine.get_initial_state()
    points = [0] * 24
    points[5] = 14
    points[0] = -3
    points[18:24] = [-2] * 6
    state.update(points=points, bar={'white': 1, 'black': 0},
                 phase='rolling', turn='white')
    if color == 'black':
        state['points'] = [-count for count in reversed(points)]
        state['bar'] = {'white': 0, 'black': 1}
        state['turn'] = 'black'
    return state


class BlockedPassRulesTests(TestCase):
    def test_fully_closed_bar_passes_without_rolling_for_either_color(self):
        for color in ('white', 'black'):
            with self.subTest(color=color):
                state = closed_bar_state(color)
                state.update(dice=[6, 5], remaining=[], lastMove=[], moveHistory=[])
                before = deepcopy(state)
                engine = BackgammonEngine(state)
                self.assertTrue(engine.is_bar_fully_blocked(color))
                result = engine.pass_blocked_turn(color)
                self.assertTrue(result['success'])
                self.assertEqual(result['event_type'], 'blocked_pass')
                self.assertEqual(result['turn_notice'], {
                    'kind': 'blocked_pass', 'color': color, 'dice': [], 'remaining': [],
                })
                self.assertEqual(state['turn'], 'black' if color == 'white' else 'white')
                self.assertEqual(state['phase'], 'rolling')
                self.assertEqual(state['dice'], [])
                self.assertEqual(state['remaining'], [])
                self.assertIsNone(state['lastMove'])
                self.assertIsNone(state['moveHistory'])
                for field in ('points', 'bar', 'home', 'cube', 'cubeOwner'):
                    self.assertEqual(state[field], before[field])

    def test_one_open_entry_or_no_bar_does_not_force_a_pass(self):
        for color in ('white', 'black'):
            for kind in ('blot', 'empty', 'no_bar'):
                with self.subTest(color=color, kind=kind):
                    state = closed_bar_state(color)
                    if kind == 'no_bar':
                        state['bar'][color] = 0
                    else:
                        state['points'][23 if color == 'white' else 0] = (
                            (-1 if color == 'white' else 1) if kind == 'blot' else 0
                        )
                    before = deepcopy(state)
                    engine = BackgammonEngine(state)
                    self.assertFalse(engine.is_bar_fully_blocked(color))
                    self.assertFalse(engine.pass_blocked_turn(color)['success'])
                    self.assertEqual(state, before)

    def test_wrong_actor_and_non_rolling_phases_cannot_pass(self):
        for color, phase in [('black', 'rolling'), ('white', 'doubling_offered'),
                             ('white', 'moving'), ('white', 'opening_roll')]:
            with self.subTest(color=color, phase=phase):
                state = closed_bar_state()
                state['phase'] = phase
                before = deepcopy(state)
                self.assertFalse(BackgammonEngine(state).pass_blocked_turn(color)['success'])
                self.assertEqual(state, before)


class BlockedPassConsumerTests(SimpleTestCase):
    async def test_roll_intent_passes_closed_bar_before_calling_dice_service(self):
        for color in ('white', 'black'):
            with self.subTest(color=color):
                consumer = GameConsumer()
                consumer.player_color = color
                engine = BackgammonEngine(closed_bar_state(color))
                with patch('game.consumers.fetch_turn_dice', AsyncMock()) as dice:
                    result = await consumer._handle_roll_intent(engine)
                dice.assert_not_awaited()
                self.assertEqual(result['event_type'], 'blocked_pass')

    async def test_one_open_entry_still_gets_real_dice(self):
        state = closed_bar_state()
        state['points'][23] = -1
        consumer = GameConsumer()
        consumer.player_color = 'white'
        engine = BackgammonEngine(state)
        with patch('game.consumers.fetch_turn_dice', AsyncMock(return_value=(1, 2))) as dice:
            result = await consumer._handle_roll_intent(engine)
        dice.assert_awaited_once()
        self.assertTrue(result['success'])
        self.assertNotIn('event_type', result)
        self.assertEqual(state['phase'], 'moving')
        self.assertEqual(state['turn'], 'white')
        self.assertEqual(state['dice'], [2, 1])

    async def test_pipeline_records_distinct_pass_and_resets_next_players_delay(self):
        stored = closed_bar_state()
        stored.update(clock={'white': 60_000, 'black': 70_000}, turnStartedAt=50_000)
        incoming = deepcopy(stored)
        result = BackgammonEngine(incoming).pass_blocked_turn('white')
        effects = {name: AsyncMock() for name in (
            'on_timeout', 'on_reschedule_timeout', 'on_opening_result',
            'on_game_over', 'on_state_update', 'on_turn_notice',
        )}
        ticks = iter([100, 100.5])
        with patch('game.server_actions.time_module', SimpleNamespace(
                time=lambda: next(ticks, 101), perf_counter=perf_counter)), \
                patch('game.server_actions.persist_state_and_advance', AsyncMock(return_value=8)) as persist:
            outcome = await apply_server_game_action(
                room=SimpleNamespace(id='room', time_control='normal', target_points=3),
                stored_state=stored, new_state=incoming, player_color='white',
                action='roll', result=result, **effects,
            )
        persist.assert_awaited_once_with('room', incoming, 'white', 'blocked_pass')
        self.assertEqual(outcome['outcome'], 'state_update')
        self.assertEqual(incoming['clock'], {'white': 22_000, 'black': 70_000})
        self.assertEqual(incoming['turnStartedAt'], 100_500)
        self.assertEqual(incoming['version'], 8)
        effects['on_state_update'].assert_awaited_once_with(
            state=incoming, player_color='white', action='roll',
        )
        effects['on_reschedule_timeout'].assert_awaited_once_with(incoming)
        effects['on_turn_notice'].assert_awaited_once_with(
            turn_notice=result['turn_notice'], player_color='white',
        )
        effects['on_timeout'].assert_not_awaited()
