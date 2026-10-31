import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, passBlockedTurn, type Color, type GameState } from "./engine";

function blockedBar(color: Color): GameState {
  const points = Array<number>(24).fill(0);
  const sign = color === "white" ? 1 : -1;
  for (let die = 1; die <= 6; die++) {
    points[color === "white" ? 24 - die : die - 1] = -2 * sign;
  }
  points[color === "white" ? 5 : 18] = 14 * sign;
  points[color === "white" ? 11 : 12] = -3 * sign;
  return {
    ...newGame(), points, turn: color, phase: "rolling",
    bar: { white: 0, black: 0, [color]: 1 },
    dice: [6, 1], remaining: [], lastMove: [{ from: 12, to: 11 }], moveHistory: [newGame()],
    cube: 2, cubeOwner: color,
  };
}

for (const color of ["white", "black"] as const) {
  const other: Color = color === "white" ? "black" : "white";

  test(`${color}: a fully closed bar passes without generating dice or mutating its source`, () => {
    const state = blockedBar(color);
    const original = structuredClone(state);
    const passed = passBlockedTurn(state, color);
    expect(passed).not.toBe(state);
    expect(state).toEqual(original);
    expect(passed).toMatchObject({
      phase: "rolling", turn: other, dice: [], remaining: [], lastMove: null, moveHistory: null,
      points: original.points, bar: original.bar, home: original.home,
      cube: original.cube, cubeOwner: original.cubeOwner, winner: null,
    });
  });

  test(`${color}: a fully closed bar cannot pass the other player's turn`, () => {
    const state = blockedBar(color);
    expect(passBlockedTurn(state, other)).toBe(state);
  });

  for (const phase of ["opening_roll", "opening_result", "moving", "doubling_offered", "game_over"] as const) {
    test(`${color}: a fully closed bar cannot pass during ${phase}`, () => {
      const state = { ...blockedBar(color), phase };
      expect(passBlockedTurn(state, color)).toBe(state);
    });
  }

  for (const scenario of ["an empty entry", "an opposing blot", "no checker on the bar"] as const) {
    test(`${color}: ${scenario} preserves the turn and its normal roll`, () => {
      const state = blockedBar(color);
      const entry = color === "white" ? 23 : 0;
      const spare = color === "white" ? 11 : 12;
      if (scenario === "an empty entry") {
        state.points[spare] += state.points[entry];
        state.points[entry] = 0;
      } else if (scenario === "an opposing blot") {
        state.points[entry] /= 2;
        state.points[spare] += state.points[entry];
      } else {
        state.bar[color] = 0;
        state.points[color === "white" ? 5 : 18] += color === "white" ? 1 : -1;
      }
      expect(passBlockedTurn(state, color)).toBe(state);
    });
  }
}
