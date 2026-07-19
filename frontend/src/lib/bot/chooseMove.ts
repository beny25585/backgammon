/**
 * 1-ply move selection adapted from backgammon-baddie (MIT).
 *
 * For every legal move in the current state, apply it, score the
 * resulting position with `evaluate`, and return the best one.
 * Deterministic: ties break by the engine's move ordering.
 */

import type { GameState, Color, Move } from "@/lib/backgammon/engine";
import { allLegalMoves, applyMove } from "@/lib/backgammon/engine";
import { evaluate } from "./evaluate";

/**
 * Choose the bot's best move for `color` in a "moving" phase state
 * (dice already rolled).
 *
 * Returns the best `Move`, or `null` when no legal move exists
 * (the caller should pass the turn).
 *
 * Throws if not in "moving" phase — the bot doesn't roll dice or
 * act on the cube.
 */
export function chooseMove(state: GameState, color: Color): Move | null {
  if (state.phase !== "moving") {
    throw new Error(
      `Bot only chooses in "moving" phase, not "${state.phase}"`,
    );
  }

  const candidates = allLegalMoves(state, color);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = evaluate(applyMove(state, best, color), color);

  for (let i = 1; i < candidates.length; i++) {
    const score = evaluate(applyMove(state, candidates[i], color), color);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }

  return best;
}
