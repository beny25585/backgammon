"""Clock is match-level: remaining time survives across games in a match."""
from django.test import TestCase

from game.clock import compute_clock
from game.consumers import GameConsumer
from game.game_service import record_game_end
from game.models import GameRoom, GameState
from game.engine import BackgammonEngine


class ClockMatchPreservationTests(TestCase):
    def test_clock_preserved_across_match(self):
        """targetPoints=9, white 222s black 251s survives into next opening_roll."""
        room = GameRoom.objects.create(code="CLK001", status="playing", target_points=9, time_control="normal")
        room.white_score = 2
        room.black_score = 1
        room.save()
        # Simulate previous game state with remaining clocks
        prev_state = {
            "phase": "game_over",
            "winner": "white",
            "winType": "single",
            "gameFormat": "match",
            "clock": {"white": 222_000, "black": 251_000},
            "turnStartedAt": None,
            "matchScored": True,
            "gameId": "first",
        }
        GameState.objects.create(room=room, state_data=prev_state)
        # Simulate scoring the game that brings score to 5-1
        # Use record_game_end to go to 5-1
        prev_state["gameId"] = "second"
        # White wins again, should go to 5-1 (actually 2+3? Let's just simulate via record_game_end)
        # For this test we directly test _handle_next_game clock preservation via compute_clock
        from asgiref.sync import async_to_sync
        from game.consumers import get_room

        # Create a fresh engine state as _handle_next_game does
        fresh = BackgammonEngine.get_initial_state()
        fresh["gameId"] = "next"
        fresh["clock"] = dict(prev_state["clock"])
        fresh["turnStartedAt"] = None
        from game.formats import carry_contract
        carry_contract(prev_state, fresh, room)
        # Now compute_clock as _start_next_game does
        import time
        now_ms = int(time.time() * 1000)
        clock, turn_started_at, new_active, timed_out, _ = compute_clock(prev_state, fresh, now_ms, room.time_control, room.target_points)
        self.assertEqual(clock["white"], 222_000)
        self.assertEqual(clock["black"], 251_000)
        self.assertIsNone(turn_started_at)
        self.assertIsNone(new_active)
        self.assertFalse(timed_out)

    def test_get_initial_state_does_not_reseed_clock(self):
        """get_initial_state must not create a clock; preservation is via stored."""
        fresh = BackgammonEngine.get_initial_state()
        self.assertNotIn("clock", fresh)
        self.assertNotIn("turnStartedAt", fresh)

    def test_turn_started_at_recreated_on_first_active_turn(self):
        """After opening, first rolling turn gets fresh turnStartedAt, not copied."""
        stored = {"phase": "opening_roll", "clock": {"white": 222_000, "black": 251_000}, "turnStartedAt": None}
        incoming = {"phase": "rolling", "turn": "white"}
        now_ms = 1_700_000_000_000
        clock, turn_started_at, new_active, _, _ = compute_clock(stored, incoming, now_ms, "normal", 9)
        self.assertEqual(clock["white"], 222_000)
        self.assertEqual(turn_started_at, now_ms)
        self.assertEqual(new_active, "white")
