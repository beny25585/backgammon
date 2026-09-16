import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, initialBoard, applyOpeningRoll, applyRoll, reorderDice, pipCount, allLegalMoves, legalMovesFrom, applyMove, undoLastMove, BAR, OFF, isTurnChoiceFreeSoFar, type Color, type GameState } from "./engine";

for (const color of ["white", "black"] as Color[]) {
  const point = (whitePoint: number) => color === "white" ? whitePoint : 23 - whitePoint;
  const sign = color === "white" ? 1 : -1;
  const position = (remaining: number[]): GameState => ({
    ...newGame(), points: Array<number>(24).fill(0), turn: color,
    phase: "moving" as const, remaining, dice: remaining.slice(0, 2),
  });

  test(`${color}: highlights only moves that use both dice before bearing off`, () => {
    const state = position([2, 1]);
    state.points[point(1)] = sign;
    state.home[color] = 14;
    const expected = [{ from: point(1), to: point(0), die: 1 }];
    expect(allLegalMoves(state, color)).toEqual(expected);
    expect(legalMovesFrom(state, point(1), color)).toEqual(expected);
    const moved = applyMove(state, expected[0], color);
    expect(allLegalMoves(moved, color)).toEqual([{ from: point(0), to: OFF, die: 2 }]);
    expect(allLegalMoves(undoLastMove(moved)!, color)).toEqual(expected);
  });

  test(`${color}: higher die is mandatory when only one entry can be played`, () => {
    const state = position([1, 2]);
    state.bar[color] = 1;
    state.home[color] = 14;
    state.points[point(21)] = -2 * sign;
    expect(legalMovesFrom(state, BAR, color)).toEqual([{ from: BAR, to: point(22), die: 2 }]);
    expect(allLegalMoves(reorderDice(state), color)).toEqual(allLegalMoves(state, color));
  });

  test(`${color}: lower die remains allowed when higher entry is blocked`, () => {
    const state = position([2, 1]);
    state.bar[color] = 1;
    state.home[color] = 14;
    state.points[point(22)] = -2 * sign;
    state.points[point(21)] = -2 * sign;
    expect(allLegalMoves(state, color)).toEqual([{ from: BAR, to: point(23), die: 1 }]);
  });

  test(`${color}: doubles use every possible move and undo restores the dice`, () => {
    let state = position([1, 1, 1, 1]);
    state.points[point(4)] = sign;
    state.home[color] = 14;
    for (let index = 0; index < 4; index += 1) {
      const before = state;
      const moves = allLegalMoves(state, color);
      expect(moves).toEqual([{ from: point(4 - index), to: point(3 - index), die: 1 }]);
      state = applyMove(state, moves[0], color);
      expect(undoLastMove(state)?.remaining).toEqual(before.remaining);
    }
    expect(state.remaining).toEqual([]);
    expect(state.turn).toBe(color);
  });

  test(`${color}: bar cannot be used without a checker and blocked entry has no move`, () => {
    const state = position([2, 1]);
    expect(legalMovesFrom(state, BAR, color)).toEqual([]);
    state.bar[color] = 1;
    state.points[point(23)] = -2 * sign;
    state.points[point(22)] = -2 * sign;
    expect(allLegalMoves(state, color)).toEqual([]);
  });
}

test("new game starts in opening roll with 15 checkers per side", async () => {
  const state = newGame();
  expect(state.phase).toBe("opening_roll");
  const totalWhite = initialBoard().filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const totalBlack = initialBoard().filter((v) => v < 0).reduce((a, b) => a - b, 0);
  expect(totalWhite).toBe(15);
  expect(totalBlack).toBe(15);
});

test("new game starts with 167 pips per side", async () => {
  const state = newGame();

  expect(pipCount(state, "white")).toBe(167);
  expect(pipCount(state, "black")).toBe(167);
});

test("applyOpeningRoll uses the provided die instead of rolling locally", async () => {
  const next = applyOpeningRoll(newGame(), "white", 4);
  expect(next.openingRoll.white).toBe(4);
  expect(next.turn).toBe("black");
  expect(next.phase).toBe("opening_roll");
});

test("opening-roll winner plays both opening dice", async () => {
  const afterWhite = applyOpeningRoll(newGame(), "white", 5);
  const resolved = applyOpeningRoll(afterWhite, "black", 2);

  expect(resolved.turn).toBe("white");
  expect(resolved.phase).toBe("opening_result");
  expect(resolved.dice).toEqual([5, 2]);
  expect(resolved.remaining).toEqual([5, 2]);
});

test("opening-roll winner plays the larger die first when black rolls higher", async () => {
  const afterWhite = applyOpeningRoll(newGame(), "white", 1);
  const resolved = applyOpeningRoll(afterWhite, "black", 6);

  expect(resolved.turn).toBe("black");
  expect(resolved.dice).toEqual([6, 1]);
  expect(resolved.remaining).toEqual([6, 1]);
});

test("normal rolls start with the larger die first", async () => {
  const state = { ...newGame(), phase: "rolling" as const };
  const resolved = applyRoll(state, [2, 5]);

  expect(resolved.dice).toEqual([5, 2]);
  expect(resolved.remaining).toEqual([5, 2]);
});

test("reorderDice reverses the playable dice order", async () => {
  const state = { ...newGame(), phase: "moving" as const, dice: [5, 2], remaining: [5, 2] };

  const next = reorderDice(state);

  expect(next.remaining).toEqual([2, 5]);
  expect(state.remaining).toEqual([5, 2]);
});

test("isTurnChoiceFreeSoFar: earlier choice followed by forced move is not choice-free", async () => {
  const points = new Array(24).fill(0);
  points[0] = 2;
  points[1] = 1;
  const s0: GameState = {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 12, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [2, 1],
    remaining: [2, 1],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  // initially multiple placements
  const placements0 = new Set(allLegalMoves(s0, "white").map((m) => `${m.from}->${m.to}`));
  expect(placements0.size).toBeGreaterThan(1);
  const s1 = applyMove(s0, { from: 0, to: OFF, die: 1 }, "white");
  // s1 should be forced (only 1 -> OFF with 2)
  expect(new Set(allLegalMoves(s1, "white").map((m) => `${m.from}->${m.to}`)).size).toBe(1);
  // current s1 is after one manual choice, so not choice-free
  expect(isTurnChoiceFreeSoFar(s1, "white")).toBe(false);
  // also check that the current move itself is forced but history had choice
  expect(allLegalMoves(s1, "white").some((m) => m.from === 1 && m.to === OFF)).toBe(true);
});

test("isTurnChoiceFreeSoFar: fully forced sequence stays choice-free", async () => {
  const s0: GameState = {
    ...newGame(),
    points: (() => { const p = new Array(24).fill(0); p[23] = 1; return p; })(),
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [4],
    remaining: [4],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  expect(new Set(allLegalMoves(s0, "white").map((m) => `${m.from}->${m.to}`)).size).toBe(1);
  expect(isTurnChoiceFreeSoFar(s0, "white")).toBe(true);
  const s1 = applyMove(s0, { from: 23, to: 19, die: 4 }, "white");
  // s1 is terminal (no remaining), but still choice-free if we check before terminal
  // For a non-terminal forced second move, create a doubles case
  const sDoubles: GameState = {
    ...newGame(),
    points: (() => { const p = new Array(24).fill(0); p[23] = 2; return p; })(),
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [4, 4],
    remaining: [4, 4],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  const sD1 = applyMove(sDoubles, { from: 23, to: 19, die: 4 }, "white");
  expect(isTurnChoiceFreeSoFar(sD1, "white")).toBe(true);
});
