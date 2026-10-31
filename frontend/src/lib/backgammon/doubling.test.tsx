import { test, expect } from "@playwright/experimental-ct-react";
import {
  allLegalMoves,
  applyMove,
  applyRoll,
  canOfferDouble,
  newGame,
  offerDouble,
  respondDouble,
  type Color,
  type GameState,
  type MatchContext,
} from "./engine";

const matchToThree: MatchContext = {
  targetPoints: 3,
  matchScore: { white: 0, black: 0 },
};

function beforeRoll(color: Color, overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(), phase: "rolling", turn: color, gameFormat: "match", ...overrides };
}

for (const color of ["white", "black"] as const) {
  const other: Color = color === "white" ? "black" : "white";

  test(`${color}: a match to three allows two to four, then rejects four to eight`, () => {
    const state = beforeRoll(color, { cube: 2, cubeOwner: color });
    expect(canOfferDouble(state, color, matchToThree)).toBe(true);

    const offered = offerDouble(state, color, matchToThree);
    expect(offered.phase).toBe("doubling_offered");
    const accepted = respondDouble(offered, true);
    expect(accepted.cube).toBe(4);
    expect(accepted.cubeOwner).toBe(other);
    expect(accepted.turn).toBe(color);

    // The new cube owner has reached their next pre-roll turn.
    const nextTurn = { ...accepted, turn: other };
    expect(canOfferDouble(nextTurn, other, matchToThree)).toBe(false);
    expect(offerDouble(nextTurn, other, matchToThree)).toEqual(nextTurn);
  });

  test(`${color}: cube eligibility uses the offering player's points still needed`, () => {
    const match: MatchContext = {
      targetPoints: 5,
      matchScore: { white: 1, black: 1, [color]: 3 },
    };
    const leader = beforeRoll(color, { cube: 2 });
    expect(canOfferDouble(leader, color, match)).toBe(false);
    expect(offerDouble(leader, color, match)).toEqual(leader);

    const trailer = beforeRoll(other, { cube: 2 });
    expect(canOfferDouble(trailer, other, match)).toBe(true);
    expect(offerDouble(trailer, other, match).phase).toBe("doubling_offered");
  });

  test(`${color}: a one-point match cannot be doubled`, () => {
    const state = beforeRoll(color);
    const match: MatchContext = { targetPoints: 1, matchScore: { white: 0, black: 0 } };
    expect(canOfferDouble(state, color, match)).toBe(false);
    expect(offerDouble(state, color, match)).toEqual(state);
  });

  test(`${color}: money games retain their configured cube limit`, () => {
    const state = beforeRoll(color, { gameFormat: "money", cube: 8, cubeOwner: color, maxCube: 16 });
    expect(canOfferDouble(state, color, matchToThree)).toBe(true);
    const accepted = respondDouble(offerDouble(state, color, matchToThree), true);
    expect(accepted.cube).toBe(16);
    const nextTurn = { ...accepted, turn: other };
    expect(canOfferDouble(nextTurn, other, matchToThree)).toBe(false);
  });

  test(`${color}: callers without match context retain cube eligibility`, () => {
    const state = beforeRoll(color, { cube: 4, cubeOwner: color });
    expect(canOfferDouble(state, color)).toBe(true);
    expect(offerDouble(state, color).phase).toBe("doubling_offered");
  });

  test(`${color}: a match context also protects rooms without a format field`, () => {
    const state = beforeRoll(color, { gameFormat: undefined, cube: 4, cubeOwner: color });
    expect(canOfferDouble(state, color, matchToThree)).toBe(false);
    expect(offerDouble(state, color, matchToThree)).toEqual(state);
  });

  test(`${color}: an incomplete match context preserves legacy cube eligibility`, () => {
    const state = beforeRoll(color, { cube: 4, cubeOwner: color });
    expect(canOfferDouble(state, color, { targetPoints: 3, matchScore: null })).toBe(true);
    expect(canOfferDouble(state, color, { targetPoints: null, matchScore: { white: 0, black: 0 } })).toBe(true);
  });

  const unavailable: { name: string; state: Partial<GameState> }[] = [
    { name: "opponent owns the cube", state: { cubeOwner: other } },
    { name: "opponent's turn", state: { turn: other } },
    { name: "dice already rolled", state: { phase: "moving", dice: [2, 3], remaining: [2, 3] } },
    { name: "configured cube maximum reached", state: { cube: 4, maxCube: 4 } },
    { name: "offered cube exceeds the configured maximum", state: { cube: 2, maxCube: 3 } },
    { name: "doubling disabled", state: { doublingEnabled: false } },
    { name: "Crawford game", state: { crawfordGame: true } },
  ];

  for (const scenario of unavailable) {
    test(`${color}: offerDouble rejects when ${scenario.name}`, () => {
      const state = beforeRoll(color, scenario.state);
      expect(canOfferDouble(state, color)).toBe(false);
      expect(offerDouble(state, color)).toEqual(state);
    });
  }

  test(`${color}: taking clears old dice and requires the offerer to roll before moving`, () => {
    const state = beforeRoll(color, {
      dice: [6, 1],
      remaining: [],
      lastMove: [{ from: color === "white" ? 23 : 0, to: color === "white" ? 22 : 1 }],
      moveHistory: [newGame()],
    });
    const accepted = respondDouble(offerDouble(state, color, matchToThree), true);
    expect(accepted.phase).toBe("rolling");
    expect(accepted.turn).toBe(color);
    expect(accepted.cubeOwner).toBe(other);
    expect(accepted.doubleOfferedBy).toBeNull();
    expect(accepted.dice).toEqual([]);
    expect(accepted.remaining).toEqual([]);
    expect(accepted.lastMove).toBeNull();
    expect(accepted.moveHistory).toBeNull();
    expect(allLegalMoves(accepted, color)).toEqual([]);
    expect(canOfferDouble(accepted, other, matchToThree)).toBe(false);

    const rolled = applyRoll(accepted, [2, 3]);
    expect(rolled.turn).toBe(color);
    expect(rolled.phase).toBe("moving");
    const moves = allLegalMoves(rolled, color);
    expect(moves.length).toBeGreaterThan(0);
    const moved = applyMove(rolled, moves[0], color);
    expect(moved.points).not.toEqual(accepted.points);
  });

  test(`${color}: declining awards the offerer the existing cube value`, () => {
    const state = beforeRoll(color, { cube: 2, cubeOwner: color });
    const declined = respondDouble(offerDouble(state, color, matchToThree), false);
    expect(declined.phase).toBe("game_over");
    expect(declined.winner).toBe(color);
    expect(declined.winType).toBe("single");
    expect(declined.cube).toBe(2);
    expect(declined.doubleOfferedBy).toBeNull();
  });

  test(`${color}: a duplicate take cannot increase the cube again`, () => {
    const accepted = respondDouble(offerDouble(beforeRoll(color), color, matchToThree), true);
    expect(respondDouble(accepted, true)).toEqual(accepted);
    expect(respondDouble(accepted, false)).toEqual(accepted);
  });

  for (const state of [
    beforeRoll(color),
    beforeRoll(color, { phase: "doubling_offered" }),
  ]) {
    test(`${color}: responses ignore invalid offer (${state.phase}, offerer=${state.doubleOfferedBy})`, () => {
      expect(respondDouble(state, true)).toEqual(state);
      expect(respondDouble(state, false)).toEqual(state);
    });
  }
}
