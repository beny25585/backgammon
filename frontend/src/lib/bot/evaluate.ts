/**
 * Positional evaluation adapted from backgammon-baddie (MIT).
 *
 * evaluate(state, color) returns one number: higher is better for `color`.
 * It is a weighted sum of named positional terms, computed once per side
 * and taken as a difference (player's score minus opponent's).
 *
 * Unit: roughly one pip — a weight of 3 means worth ~3 pips in the race.
 * Weights are the baddie's v1 heuristics, tuned for sanity not strength.
 */

import type { GameState, Color } from "@/lib/backgammon/engine";

// ── Weights ──────────────────────────────────────────────────────────

/** A finished game outscores any positional consideration. */
const WIN_SCORE = 1_000_000;

/** One pip remaining in the race. */
const PIP = 1;

/** A checker already borne off — beyond the pips it no longer travels. */
const BORNE_OFF = 10;

/**
 * A checker on the bar — tempo cost (must re-enter, may dance).
 * Added on top of its 25-pip journey already charged in pip count.
 */
const ON_BAR = 12;

/** A blot (lone checker) — base exposure cost. */
const BLOT = 4;

/** Extra blot cost per die value that would hit it directly right now. */
const BLOT_DIRECT_SHOT = 2;

/** A made point (2+ checkers) — safe landing, blocks opponent. */
const MADE_POINT = 3;

/** Extra credit for a made point in own home board (blocks opponent re-entry). */
const HOME_BOARD_POINT = 2;

/** Extra credit per adjacent pair of made points (building a prime). */
const PRIME_PAIR = 2;

// ── Helpers ──────────────────────────────────────────────────────────

function opponentOf(c: Color): Color {
  return c === "white" ? "black" : "white";
}

/**
 * Convert absolute point to relative distance from bear-off.
 * In 0-indexed: white bears off at 0, black at 23.
 * Relative 1 = closest to bear-off, 24 = farthest.
 */
function pointFor(color: Color, absolute: number): number {
  return color === "white" ? absolute + 1 : 24 - absolute;
}

/** Number of checkers of `color` on a point (0 if none or opponent). */
function countOn(state: GameState, pt: number, color: Color): number {
  const v = state.points[pt];
  if (color === "white") return v > 0 ? v : 0;
  return v < 0 ? -v : 0;
}

/** Does `color` have 2+ checkers on this point? */
function isMade(state: GameState, pt: number, color: Color): boolean {
  return countOn(state, pt, color) >= 2;
}

/** Does `color` have exactly 1 checker on this point (a blot)? */
function isBlot(state: GameState, pt: number, color: Color): boolean {
  return countOn(state, pt, color) === 1;
}

// ── Public API ───────────────────────────────────────────────────────

export { WIN_SCORE };

/**
 * Score a position for `color`: higher is better.
 * Terminal wins → +WIN_SCORE, losses → -WIN_SCORE.
 */
export function evaluate(state: GameState, color: Color): number {
  const opponent = opponentOf(color);

  // Terminal check
  if (state.phase === "game_over") {
    return state.winner === color ? WIN_SCORE : -WIN_SCORE;
  }
  if (state.home[color] === 15) return WIN_SCORE;
  if (state.home[opponent] === 15) return -WIN_SCORE;

  return sideScore(state, color) - sideScore(state, opponent);
}

/** One side's positional score. */
function sideScore(state: GameState, color: Color): number {
  let score = 0;
  score -= PIP * pipCount(state, color);
  score += BORNE_OFF * state.home[color];
  score -= ON_BAR * state.bar[color];
  score -= blotExposure(state, color);
  score += structureScore(state, color);
  return score;
}

/**
 * Total pips `color` still has to travel.
 * Bar checkers count 25, each board checker counts its relative distance.
 */
export function pipCount(state: GameState, color: Color): number {
  let pips = 25 * state.bar[color];
  for (let i = 0; i < 24; i++) {
    pips += countOn(state, i, color) * pointFor(color, i);
  }
  return pips;
}

/**
 * Blot exposure cost: base penalty per blot + per direct shot.
 */
function blotExposure(state: GameState, color: Color): number {
  const opponent = opponentOf(color);
  let penalty = 0;
  for (let i = 0; i < 24; i++) {
    if (!isBlot(state, i, color)) continue;
    penalty += BLOT + BLOT_DIRECT_SHOT * directShots(state, opponent, i);
  }
  return penalty;
}

/**
 * How many distinct die values (1-6) let `hitter` hit a checker on
 * 0-indexed point `target` right now.
 */
function directShots(state: GameState, hitter: Color, target: number): number {
  const targetRel = pointFor(hitter, target);
  let shots = 0;
  for (let die = 1; die <= 6; die++) {
    const fromRel = targetRel + die;
    // Check if a hitter checker is at the corresponding absolute point
    // (the hitter moves from high relative points toward 1)
    if (fromRel <= 24) {
      const fromAbs = hitter === "white" ? fromRel - 1 : 24 - fromRel;
      if (countOn(state, fromAbs, hitter) > 0) {
        shots += 1;
        continue;
      }
    }
    // Check if hits from bar
    if (fromRel === 25 && state.bar[hitter] > 0) {
      shots += 1;
    }
  }
  return shots;
}

/**
 * Structure score: made points, home board strength, prime building.
 */
function structureScore(state: GameState, color: Color): number {
  let score = 0;
  let previousMade = false;
  for (let rel = 1; rel <= 24; rel++) {
    const abs = color === "white" ? rel - 1 : 24 - rel;
    if (abs < 0 || abs > 23) continue;
    const made = isMade(state, abs, color);
    if (made) {
      score += MADE_POINT;
      if (rel <= 6) score += HOME_BOARD_POINT;
      if (previousMade) score += PRIME_PAIR;
    }
    previousMade = made;
  }
  return score;
}
