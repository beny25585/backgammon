import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, initialBoard, applyOpeningRoll, applyRoll, reorderDice, pipCount } from "./engine";

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
