import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, type GameState } from "../backgammon/engine";
import { getGameSound, type GameSoundSnapshot } from "./gameSoundEvents";

function position(overrides: Partial<GameState> = {}): GameState {
  return {
    ...newGame(),
    phase: "rolling",
    openingRoll: { white: 6, black: 1 },
    ...overrides,
  };
}

function snapshot(
  state: GameState | null,
  overrides: Partial<GameSoundSnapshot> = {},
): GameSoundSnapshot {
  return {
    state,
    roomId: "room-a",
    playerColor: "white",
    matchScore: { white: 0, black: 0 },
    isLoading: false,
    reconnected: false,
    ...overrides,
  };
}

function rolled(): GameState {
  return position({ phase: "moving", dice: [6, 1], remaining: [6, 1] });
}

test("a fresh snapshot, missing state or a different room never replays a roll", () => {
  const before = snapshot(position());
  const after = snapshot(rolled());
  expect(getGameSound(snapshot(null), after)).toBeNull();
  expect(getGameSound(before, snapshot(null))).toBeNull();
  expect(getGameSound(before, { ...after, roomId: "room-b" })).toBeNull();
  expect(getGameSound({ ...before, roomId: undefined }, after)).toBeNull();
});

test("loading and the first reconnected snapshot suppress stale game events", () => {
  const before = snapshot(position());
  const after = snapshot(rolled());
  expect(getGameSound({ ...before, isLoading: true }, after)).toBeNull();
  expect(getGameSound(before, { ...after, isLoading: true })).toBeNull();
  expect(getGameSound(before, { ...after, reconnected: true })).toBeNull();
  expect(getGameSound(
    { ...before, reconnected: true },
    { ...after, reconnected: true },
  )).toBe("roll");
});

test("changing the online player identity suppresses the previous player's event", () => {
  expect(getGameSound(
    snapshot(position()),
    snapshot(rolled(), { playerColor: "black" }),
  )).toBeNull();
});

test("a second reconnect is silent even while the reconnect notice is still visible", () => {
  const before = snapshot(position(), { reconnected: true, connectionEpoch: 1 });
  const after = snapshot(rolled(), { reconnected: true, connectionEpoch: 2 });
  expect(getGameSound(before, after)).toBeNull();
  expect(getGameSound(before, { ...after, connectionEpoch: 1 })).toBe("roll");
});

test("a regular roll is heard once, including doubles", () => {
  const before = snapshot(position());
  const after = snapshot(rolled());
  expect(getGameSound(before, after)).toBe("roll");
  expect(getGameSound(after, { ...after, state: { ...after.state! } })).toBeNull();
  expect(getGameSound(before, snapshot(position({
    phase: "moving", dice: [5, 5], remaining: [5, 5, 5, 5],
  })))).toBe("roll");
});

test("both opening dice are heard when each arrives, without repeating a revealed result", () => {
  const initial = snapshot(position({
    phase: "opening_roll", openingRoll: { white: null, black: null },
  }));
  const first = snapshot(position({
    phase: "opening_roll", openingRoll: { white: 6, black: null },
  }));
  const second = snapshot(position({
    phase: "opening_result", openingRoll: { white: 6, black: 1 },
  }));
  expect(getGameSound(initial, first)).toBe("roll");
  expect(getGameSound(first, second)).toBe("roll");
  expect(getGameSound(second, snapshot(position({
    phase: "rolling", openingRoll: { white: 6, black: 1 },
  })))).toBeNull();
});

test("a double offer sounds once while its decision remains open", () => {
  const before = snapshot(position({ turn: "black" }));
  const offered = snapshot(position({
    phase: "doubling_offered", turn: "black", doubleOfferedBy: "black",
  }));
  expect(getGameSound(before, offered)).toBe("double");
  expect(getGameSound(offered, {
    ...offered, state: { ...offered.state!, version: 2 },
  })).toBeNull();
  expect(getGameSound(offered, snapshot(position({
    turn: "black", cube: 2, cubeOwner: "white",
  })))).toBeNull();
});

for (const color of ["white", "black"] as const) {
  test(`a ${color} capture is heard even when it also ends the turn`, () => {
    const opponent = color === "white" ? "black" : "white";
    const points = Array<number>(24).fill(0);
    const sign = color === "white" ? 1 : -1;
    points[6] = sign * 2;
    points[3] = -sign;
    const before = snapshot(position({
      phase: "moving", turn: color, points,
      dice: [3, 1], remaining: [3], lastMove: [],
    }));
    const afterPoints = [...points];
    afterPoints[6] = sign;
    afterPoints[3] = sign;
    const after = snapshot(position({
      turn: opponent, points: afterPoints,
      bar: { white: 0, black: 0, [opponent]: 1 },
      lastMove: null,
    }));
    expect(getGameSound(before, after)).toBe("hit");
    expect(getGameSound(after, { ...after, state: { ...after.state! } })).toBeNull();
  });

  test(`bearing off ${color} sounds once, while undoing it is silent`, () => {
    const before = snapshot(position({
      phase: "moving", turn: color, home: { white: 0, black: 0 },
      lastMove: [{ from: 5, to: 4 }],
    }));
    const after = snapshot(position({
      turn: color === "white" ? "black" : "white",
      home: { white: 0, black: 0, [color]: 1 }, lastMove: null,
    }));
    expect(getGameSound(before, after)).toBe("bearOff");
    expect(getGameSound(after, { ...after, state: { ...after.state! } })).toBeNull();
    expect(getGameSound(after, before)).toBeNull();
  });
}

test("a changed bar without a captured blot does not sound like a hit", () => {
  const before = snapshot(position());
  const after = snapshot(position({ bar: { white: 0, black: 1 } }));
  expect(getGameSound(before, after)).toBeNull();
});

test("moving a checker requires both an added move and a changed board", () => {
  const beforeState = rolled();
  const afterPoints = [...beforeState.points];
  afterPoints[23] -= 1;
  afterPoints[22] += 1;
  const before = snapshot(beforeState);
  const after = snapshot({
    ...beforeState, points: afterPoints, lastMove: [{ from: 23, to: 22 }],
  });
  expect(getGameSound(before, after)).toBe("move");
  expect(getGameSound(after, before)).toBeNull();
  expect(getGameSound(before, snapshot({
    ...beforeState, lastMove: [{ from: 23, to: 22 }],
  }))).toBeNull();
});

test("an optimistic winner alone cannot produce a victory cue", () => {
  const before = snapshot(rolled());
  const optimistic = snapshot(position({ phase: "game_over", winner: "white" }));
  expect(getGameSound(before, optimistic)).toBeNull();
  expect(getGameSound(optimistic, {
    ...optimistic, state: { ...optimistic.state!, version: 99 },
  })).toBeNull();
});

test("an authoritative own win is heard once when the score arrives after the board", () => {
  const optimistic = snapshot(position({ phase: "game_over", winner: "white" }));
  const confirmed = { ...optimistic, matchScore: { white: 2, black: 0 } };
  expect(getGameSound(optimistic, confirmed)).toBe("win");
  expect(getGameSound(confirmed, {
    ...confirmed, matchScore: { ...confirmed.matchScore }, state: { ...confirmed.state! },
  })).toBeNull();
});

test("victory takes priority over bearing off the final checker", () => {
  const before = snapshot(position({ phase: "moving", home: { white: 14, black: 0 } }));
  const after = snapshot(position({
    phase: "game_over", winner: "white", home: { white: 15, black: 0 },
  }), { matchScore: { white: 1, black: 0 } });
  expect(getGameSound(before, after)).toBe("win");
});

test("the opponent winning an online game does not play the celebration", () => {
  const before = snapshot(rolled());
  const after = snapshot(position({ phase: "game_over", winner: "black" }), {
    matchScore: { white: 0, black: 1 },
  });
  expect(getGameSound(before, after)).toBeNull();
});

test("local play celebrates the active human player's confirmed victory for either color", () => {
  for (const winner of ["white", "black"] as const) {
    const before = snapshot(rolled(), { roomId: undefined, playerColor: winner });
    const after = snapshot(position({ phase: "game_over", winner }), {
      roomId: undefined, playerColor: winner, matchScore: { white: 0, black: 0, [winner]: 1 },
    });
    expect(getGameSound(before, after)).toBe("win");
  }
});

test("a local computer win never celebrates the human player's defeat", () => {
  const before = snapshot(rolled(), { roomId: undefined, playerColor: "white" });
  const after = snapshot(position({ phase: "game_over", winner: "black" }), {
    roomId: undefined, playerColor: "white", matchScore: { white: 0, black: 1 },
  });
  expect(getGameSound(before, after)).toBeNull();
});

test("a score correction or an unrelated score increment cannot sound like a win", () => {
  const before = snapshot(rolled(), { matchScore: { white: 2, black: 0 } });
  const terminal = position({ phase: "game_over", winner: "white" });
  expect(getGameSound(before, snapshot(terminal, {
    matchScore: { white: 1, black: 0 },
  }))).toBeNull();
  expect(getGameSound(before, snapshot(terminal, {
    matchScore: { white: 2, black: 1 },
  }))).toBeNull();
  expect(getGameSound(before, snapshot(rolled(), {
    matchScore: { white: 3, black: 0 },
  }))).toBeNull();
});

test("loading a saved result with its initial score does not celebrate it again", () => {
  const terminal = position({ phase: "game_over", winner: "white" });
  expect(getGameSound(
    snapshot(terminal, { matchScore: null }),
    snapshot(terminal, { matchScore: { white: 3, black: 0 } }),
  )).toBeNull();
});
