import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, initialBoard, applyOpeningRoll, applyRoll, reorderDice, pipCount, allLegalMoves, legalMovesFrom, applyMove, undoLastMove, BAR, OFF, getAutomaticMove, getDeterministicTurnSequence, isWholeTurnDeterministic, type Color, type GameState } from "./engine";

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

test("deterministic turn: two bar checkers may enter in either order", async () => {
  for (const color of ["white", "black"] as Color[]) {
    const points = Array(24).fill(0);
    const state: GameState = {
      ...newGame(),
      points,
      bar: { white: color === "white" ? 2 : 0, black: color === "black" ? 2 : 0 },
      home: { white: color === "white" ? 13 : 0, black: color === "black" ? 13 : 0 },
      turn: color,
      phase: "moving",
      dice: [5, 3],
      remaining: [5, 3],
      lastMove: [],
      moveHistory: [],
      message: "",
    };
    expect(allLegalMoves(state, color).length).toBe(2);
    const sequence = getDeterministicTurnSequence(state, color);
    expect(sequence).not.toBeNull();
    expect(sequence!.length).toBe(2);
    expect(sequence!.map((m) => m.die)).toEqual([5, 3]);
    expect(sequence!.every((m) => m.from === BAR)).toBe(true);
    const destinations = sequence!.map((m) => m.to).sort((a, b) => (a as number) - (b as number));
    if (color === "white") {
      expect(destinations).toEqual([19, 21]);
    } else {
      expect(destinations).toEqual([2, 4]);
    }
    let cur = state;
    for (const mv of sequence!) {
      cur = applyMove(cur, mv, color);
    }
    expect(cur.bar[color]).toBe(0);
    expect(cur.remaining).toEqual([]);
    expect(isWholeTurnDeterministic(cur, color)).toBe(true);
  }
});

test("meaningful earlier choice prevents whole-turn auto-confirm", async () => {
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
  const placements0 = new Set(allLegalMoves(s0, "white").map((m) => `${m.from}->${m.to}`));
  expect(placements0.size).toBeGreaterThan(1);
  expect(getDeterministicTurnSequence(s0, "white")).toBeNull();
  expect(isWholeTurnDeterministic(s0, "white")).toBe(false);
  const s1 = applyMove(s0, { from: 0, to: OFF, die: 1 }, "white");
  expect(new Set(allLegalMoves(s1, "white").map((m) => `${m.from}->${m.to}`)).size).toBe(1);
  expect(getAutomaticMove(s1, "white")).not.toBeNull();
  expect(isWholeTurnDeterministic(s1, "white")).toBe(false);
  expect(allLegalMoves(s1, "white").some((m) => m.from === 1 && m.to === OFF)).toBe(true);
});

test("order-equivalent sequences return deterministic", async () => {
  const points = Array(24).fill(0);
  const state: GameState = {
    ...newGame(),
    points,
    bar: { white: 2, black: 0 },
    home: { white: 13, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [5, 3],
    remaining: [5, 3],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  const seq = getDeterministicTurnSequence(state, "white");
  expect(seq).not.toBeNull();
  // Both orders lead to same outcome, so deterministic
  expect(seq!.length).toBe(2);
});

test("two sequences producing different final board states return non-deterministic", async () => {
  const points = new Array(24).fill(0);
  points[0] = 2;
  points[1] = 1;
  const state: GameState = {
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
  expect(getDeterministicTurnSequence(state, "white")).toBeNull();
  expect(getAutomaticMove(state, "white")).toBeNull();
});

test("manual meaningful first choice -> later forced final move: forced continuation plays automatically but NO auto-confirm", async () => {
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
  expect(getDeterministicTurnSequence(s0, "white")).toBeNull();
  const s1 = applyMove(s0, { from: 0, to: OFF, die: 1 }, "white");
  // s1 has forced continuation
  const auto = getAutomaticMove(s1, "white");
  expect(auto).toEqual({
    from: 1,
    to: OFF,
    die: 2,
  });
  // But whole turn was not deterministic, so no auto-confirm
  expect(isWholeTurnDeterministic(s1, "white")).toBe(false);
});

test("fully deterministic ordinary single-placement turn still auto-confirms", async () => {
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
  expect(getDeterministicTurnSequence(s0, "white")).not.toBeNull();
  expect(getAutomaticMove(s0, "white")).not.toBeNull();
  expect(isWholeTurnDeterministic(s0, "white")).toBe(true);
  const s1 = applyMove(s0, { from: 23, to: 19, die: 4 }, "white");
  expect(s1.remaining).toEqual([]);
  expect(isWholeTurnDeterministic(s1, "white")).toBe(true);
});

test("deterministic doubles", async () => {
  const solo: GameState = {
    ...newGame(),
    points: (() => { const p = new Array(24).fill(0); p[23] = 1; return p; })(),
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [3, 3],
    remaining: [3, 3, 3, 3],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  const seq = getDeterministicTurnSequence(solo, "white");
  expect(seq).not.toBeNull();
  expect(seq!.length).toBe(4);
  expect(isWholeTurnDeterministic(solo, "white")).toBe(true);
});

test("one BAR entry blocked: obey maximum-dice/higher-die rules and do not invent an illegal sequence", async () => {
  const points = new Array(24).fill(0);
  // Block entry for die 5 for white (point 19) with 2 black checkers
  points[19] = -2;
  const state: GameState = {
    ...newGame(),
    points,
    bar: { white: 2, black: 0 },
    home: { white: 13, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [5, 3],
    remaining: [5, 3],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  // Only die 3 can enter, and only one checker can enter per turn under blocking
  const moves = allLegalMoves(state, "white");
  expect(moves.length).toBe(1);
  expect(moves[0].die).toBe(3);
  const seq = getDeterministicTurnSequence(state, "white");
  expect(seq).not.toBeNull();
  expect(seq!.length).toBe(1);
  expect(seq![0].die).toBe(3);
  expect(isWholeTurnDeterministic(state, "white")).toBe(true);
});

test("both BAR entries blocked: preserve existing no-moves auto-pass behavior", async () => {
  const points = new Array(24).fill(0);
  points[19] = -2;
  points[21] = -2;
  const state: GameState = {
    ...newGame(),
    points,
    bar: { white: 2, black: 0 },
    home: { white: 13, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [5, 3],
    remaining: [5, 3],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  expect(allLegalMoves(state, "white")).toEqual([]);
  const seq = getDeterministicTurnSequence(state, "white");
  expect(seq).not.toBeNull();
  expect(seq!.length).toBe(0);
});
