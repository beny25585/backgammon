import { test, expect } from "@playwright/experimental-ct-react";
import {
  parseTimeControl,
  activePlayerOf,
  applyClockTransition,
  formatClock,
  reserveLeft,
  delayLeft,
  TIME_CONTROL_PRESETS,
} from "./clock";
import { newGame } from "./backgammon/engine";

test("parseTimeControl parses presets and rejects no-limit", () => {
  expect(parseTimeControl("fast")).toEqual({ base: 60_000, delay: 5_000 });
  expect(parseTimeControl("normal")).toEqual({ base: 120_000, delay: 12_000 });
  expect(parseTimeControl("slow")).toEqual({ base: 300_000, delay: 12_000 });
  expect(parseTimeControl("none")).toBeNull();
  expect(parseTimeControl(null)).toBeNull();
  expect(parseTimeControl("bogus")).toBeNull();
});

test("parseTimeControl still parses legacy M+S ids", () => {
  expect(parseTimeControl("2+12")).toEqual({ base: 120_000, delay: 12_000 });
  expect(parseTimeControl("1+5")).toEqual({ base: 60_000, delay: 5_000 });
});

test("activePlayerOf is null during the opening roll, and the turn once play starts", () => {
  expect(activePlayerOf(newGame())).toBeNull(); // opening_roll: clock doesn't run
  expect(activePlayerOf({ ...newGame(), phase: "moving", turn: "white" })).toBe("white");
  expect(activePlayerOf({ ...newGame(), phase: "game_over", winner: "white" })).toBeNull();
});

test("activePlayerOf charges the responder during doubling", () => {
  const state = { ...newGame(), phase: "doubling_offered" as const, doubleOfferedBy: "white" as const };
  expect(activePlayerOf(state)).toBe("black");
});

test("applyClockTransition charges only time beyond the delay", () => {
  const clock = { white: 120_000, black: 120_000 };
  // Moved in 5s, delay 12s: nothing charged, no bonus banked.
  const next = applyClockTransition(clock, "white", "black", 5_000, 12_000);
  expect(next.white).toBe(120_000);
  expect(next.black).toBe(120_000);
});

test("applyClockTransition charges past the delay", () => {
  const clock = { white: 120_000, black: 120_000 };
  // Took 15s, delay 12s: 3s charged from reserve.
  const next = applyClockTransition(clock, "white", "black", 15_000, 12_000);
  expect(next.white).toBe(117_000);
  expect(next.black).toBe(120_000);
});

test("applyClockTransition floors at zero", () => {
  const next = applyClockTransition({ white: 2_000, black: 120_000 }, "white", "black", 5_000, 0);
  expect(next.white).toBe(0);
});

test("applyClockTransition no-ops when the active player is unchanged", () => {
  const clock = { white: 120_000, black: 120_000 };
  expect(applyClockTransition(clock, "white", "white", 5_000, 12_000)).toEqual(clock);
});

test("reserveLeft and delayLeft expose the two live counters", () => {
  const clock = { white: 120_000, black: 120_000 };
  // Active since 8s ago, delay 12s: reserve untouched, 4s delay left.
  expect(reserveLeft(clock, "white", 1_000, 9_000, 12_000)).toBe(120_000);
  expect(delayLeft("white", 1_000, 9_000, 12_000)).toBe(4_000);
  // Active since 15s ago: reserve drained by 3s, no delay left.
  expect(reserveLeft(clock, "white", 1_000, 16_000, 12_000)).toBe(117_000);
  expect(delayLeft("white", 1_000, 16_000, 12_000)).toBe(0);
});

test("formatClock renders m:ss, zero, and no-limit dash", () => {
  expect(formatClock(65_000)).toBe("1:05");
  expect(formatClock(0)).toBe("0:00");
  expect(formatClock(null)).toBe("--:--");
  expect(TIME_CONTROL_PRESETS[0].id).toBe("none");
});
