import { test, expect } from "@playwright/experimental-ct-react";
import { getGuidance } from "./guidance";
import { makeGameState } from "../../test-utils/gameState";

test("returns null during game_over", () => {
  const g = getGuidance(makeGameState({ phase: "game_over" }), "white");
  expect(g).toBeNull();
});

test("waiting phase shows waiting text", () => {
  const g = getGuidance(makeGameState({ phase: "waiting" }), "white");
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting to start");
});

test("opening roll on my turn → 'Roll to start' with roll interaction", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_roll", turn: "white" }),
    "white",
  );
  expect(g).toEqual({
    variant: "roll",
    text: "Roll to start",
    dice: [],
    remaining: [],
    interactive: "roll",
  });
});

test("opening roll on opponent's turn → waiting text, no interaction", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_roll", turn: "white" }),
    "black",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting for opponent's roll");
  expect(g?.interactive).toBeNull();
});

test("opening result won → 'You go first!'", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_result", turn: "white" }),
    "white",
  );
  expect(g?.variant).toBe("opening");
  expect(g?.text).toBe("You go first!");
});

test("opening result lost → 'Opponent goes first'", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_result", turn: "white" }),
    "black",
  );
  expect(g?.text).toBe("Opponent goes first");
});

test("doubling offered to me → double interaction", () => {
  const g = getGuidance(
    makeGameState({
      phase: "doubling_offered",
      turn: "white",
      doubleOfferedBy: "black",
    }),
    "white",
  );
  expect(g?.variant).toBe("double");
  expect(g?.text).toBe("Opponent offers a double!");
  expect(g?.interactive).toBe("double");
});

test("doubling offered by me → waiting text", () => {
  const g = getGuidance(
    makeGameState({
      phase: "doubling_offered",
      turn: "white",
      doubleOfferedBy: "white",
    }),
    "white",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting for their response");
});

test("rolling on my turn → roll interaction", () => {
  const g = getGuidance(makeGameState({ phase: "rolling", turn: "white" }), "white");
  expect(g?.variant).toBe("roll");
  expect(g?.text).toBe("Your turn — tap to roll");
  expect(g?.interactive).toBe("roll");
});

test("rolling on opponent's turn → 'Opponent is thinking…'", () => {
  const g = getGuidance(makeGameState({ phase: "rolling", turn: "black" }), "white");
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Opponent is thinking…");
});

test("moving on my turn with dice → move variant with dice", () => {
  const state = makeGameState({
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  const g = getGuidance(state, "white");
  expect(g?.variant).toBe("move");
  expect(g?.text).toBe("Your turn — tap a checker to move");
  expect(g?.dice).toEqual([4, 3]);
  expect(g?.remaining).toEqual([4, 3]);
});

test("moving on my turn with all dice used → confirm", () => {
  const g = getGuidance(
    makeGameState({ phase: "moving", turn: "white", dice: [], remaining: [] }),
    "white",
  );
  expect(g?.variant).toBe("confirm");
  expect(g?.text).toBe("Confirm your turn");
});

test("moving on my turn with no legal moves → no-moves", () => {
  const points = new Array(24).fill(0);
  points[18] = -2; // black blockade on white's entry point for die 6
  const g = getGuidance(
    makeGameState({
      phase: "moving",
      turn: "white",
      dice: [6],
      remaining: [6],
      bar: { white: 1, black: 0 },
      points,
    }),
    "white",
  );
  expect(g?.variant).toBe("no-moves");
  expect(g?.text).toBe("No moves available — turn passes");
});

test("moving on opponent's turn → 'Opponent is thinking…'", () => {
  const g = getGuidance(
    makeGameState({ phase: "moving", turn: "black", dice: [4, 3], remaining: [4, 3] }),
    "white",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Opponent is thinking…");
});
