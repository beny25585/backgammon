import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, initialBoard, applyOpeningRoll } from "./engine";

test("new game starts in opening roll with 15 checkers per side", async () => {
  const state = newGame();
  expect(state.phase).toBe("opening_roll");
  const totalWhite = initialBoard().filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const totalBlack = initialBoard().filter((v) => v < 0).reduce((a, b) => a - b, 0);
  expect(totalWhite).toBe(15);
  expect(totalBlack).toBe(15);
});

test("applyOpeningRoll uses the provided die instead of rolling locally", async () => {
  const next = applyOpeningRoll(newGame(), "white", 4);
  expect(next.openingRoll.white).toBe(4);
  expect(next.turn).toBe("black");
  expect(next.phase).toBe("opening_roll");
});
