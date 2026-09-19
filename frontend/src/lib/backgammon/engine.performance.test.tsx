import { test, expect } from "@playwright/experimental-ct-react";
import { allLegalMoves, applyMove, applyRoll, getAutomaticMove, getDeterministicTurnSequence, newGame, pipCount, reorderDice, undoLastMove, type GameState } from "./engine";
import { chooseMove } from "../bot/chooseMove";

test("profiles core operations across deterministic complete games", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Pure engine runs in Node; run once rather than once per browser.");
  const samples: Record<string, number[]> = {};
  function measure<T>(name: string, operation: () => T): T {
    const start = performance.now();
    const result = operation();
    (samples[name] ??= []).push(performance.now() - start);
    return result;
  }
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  let completed = 0;
  for (let game = 0; game < 20; game++) {
    let state: GameState = { ...newGame(), phase: "rolling" };
    for (let step = 0; step < 3000 && state.phase !== "game_over"; step++) {
      if (state.phase === "rolling") {
        state = measure("roll", () => applyRoll(state, [random() % 6 + 1, random() % 6 + 1]));
      }
      const moves = measure("legalMoves", () => allLegalMoves(state, state.turn));
      measure("automaticMove", () => getAutomaticMove(state, state.turn));
      measure("deterministicTurn", () => getDeterministicTurnSequence(state, state.turn));
      measure("pipCounts", () => [pipCount(state, "white"), pipCount(state, "black")]);
      measure("reorderDice", () => reorderDice(state));
      if (state.phase === "moving") measure("botChoice", () => chooseMove(state, state.turn));
      const packet = measure("serializeState", () => JSON.stringify(state));
      measure("parseState", () => JSON.parse(packet));
      if (moves.length && state.phase === "moving") {
        const before = state;
        state = measure("move", () => applyMove(state, moves[random() % moves.length], state.turn));
        if (state.moveHistory?.length) {
          const restored = measure("undo", () => undoLastMove(state));
          expect(restored?.points).toEqual(before.points);
          expect(restored?.remaining).toEqual(before.remaining);
        }
      } else if (state.phase === "moving") {
        state = { ...state, phase: "rolling", turn: state.turn === "white" ? "black" : "white", dice: [], remaining: [], lastMove: null, moveHistory: null };
      }
    }
    if (state.phase === "game_over") completed++;
  }
  const metrics = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    values.sort((a, b) => a - b);
    return [name, { samples: values.length, p50ms: values[Math.floor(values.length * .5)], p95ms: values[Math.floor(values.length * .95)], maxMs: values[values.length - 1] }];
  }));
  console.log(JSON.stringify({ completedGames: completed, metrics }));
  await testInfo.attach("engine-timings", { body: JSON.stringify({ completedGames: completed, metrics }, null, 2), contentType: "application/json" });
  expect(completed).toBe(20);
});
