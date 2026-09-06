// ============================================================
// Pure Backgammon Engine — no side effects, no external deps
// ============================================================

export const BAR = "bar" as const;
export const OFF = "off" as const;
export type Source = number | "bar";
export type Target = number | "off";

// Board layout (0-indexed points 0..23):
//
//   12   13   14   15   16   17  | BAR | 18   19   20   21   22   23
//  ──────────────────────────────|─────|──────────────────────────────
//   11   10    9    8    7    6  |     |   5    4    3    2    1    0
//
// White moves counter-clockwise: 23 -> 0 -> bear off
// Black moves clockwise:          0 -> 23 -> bear off
// Board value convention:  white > 0, black < 0

// ============================================================
// Constants
// ============================================================

const BOARD_SIZE = 24;
const TOTAL_CHECKERS = 15;
const CUBE_MAX = 64;
const DIRECTION: Record<Color, number> = { white: -1, black: 1 };
const HOME: Record<Color, { start: number; end: number }> = {
  white: { start: 0, end: 5 },
  black: { start: 18, end: 23 },
};

// ============================================================
// Types
// ============================================================

export type Color = "white" | "black";

export type Phase =
  | "waiting"
  | "opening_roll"
  | "opening_result"
  | "rolling"
  | "moving"
  | "doubling_offered"
  | "game_over";

export interface GameState {
  points: number[]; // length 24: positive = white, negative = black
  bar: { white: number; black: number };
  home: { white: number; black: number };
  turn: Color;
  dice: number[];
  remaining: number[]; // dice values still available this turn
  phase: Phase;
  cube: number; // doubling cube value (1, 2, 4, 8...)
  cubeOwner: Color | "center";
  doublingEnabled?: boolean;
  doubleOfferedBy: Color | null;
  winner: Color | null;
  winType: "single" | "gammon" | "backgammon" | null;
  openingRoll: { white: number | null; black: number | null };
  lastMove: { from: Source; to: Target }[] | null;
  /** Stack of pre-move snapshots for undo during the current turn. Cleared at turn end. */
  moveHistory: GameState[] | null;
  message: string;
  version?: number;
  /** Server-owned per-player remaining reserve in ms (online). Absent in local mode. */
  clock?: { white: number; black: number };
  /** Server wall-clock ms when the current turn began (for the delay countdown). */
  turnStartedAt?: number;
}

export interface Move {
  from: Source;
  to: Target;
  die: number;
}

export type WinType = "single" | "gammon" | "backgammon";

// ============================================================
// Color helpers
// ============================================================

/** Returns the opponent color. */
function opponent(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** How many steps a checker moves per pip (white = backward, black = forward). */
function stepDirection(color: Color): number {
  return DIRECTION[color];
}

// ============================================================
// Board query helpers
// ============================================================

/** True if `point` has at least one checker of `color`. */
function isOwnedBy(state: GameState, point: number, color: Color): boolean {
  return color === "white" ? state.points[point] > 0 : state.points[point] < 0;
}

/** True if `point` has exactly one opponent checker (vulnerable to capture). */
function isOpponentBlot(
  state: GameState,
  point: number,
  color: Color,
): boolean {
  return color === "white"
    ? state.points[point] === -1
    : state.points[point] === 1;
}

/** True if `point` has 2+ opponent checkers (blocked, can't land here). */
function isOpponentBlockade(
  state: GameState,
  point: number,
  color: Color,
): boolean {
  return color === "white"
    ? state.points[point] <= -2
    : state.points[point] >= 2;
}

/** Count of `color`'s checkers currently on the board (not on bar, not borne off). */
function checkersOnBoard(state: GameState, color: Color): number {
  let count = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (isOwnedBy(state, i, color)) {
      count += Math.abs(state.points[i]);
    }
  }
  return count;
}

/** True if all of `color`'s checkers are in their home board (none outside, none on bar). */
function allCheckersInHome(state: GameState, color: Color): boolean {
  if (state.bar[color] > 0) return false;
  const { start, end } = HOME[color];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (isOwnedBy(state, i, color)) {
      if (i < start || i > end) return false;
    }
  }
  return true;
}

/** Total checkers in home board — both on points and already borne off — must be exactly 15. */
function allCheckersAccountedInHome(state: GameState, color: Color): boolean {
  return checkersOnBoard(state, color) + state.home[color] === TOTAL_CHECKERS;
}

/** Full check: can `color` legally bear off? */
function canBearOff(state: GameState, color: Color): boolean {
  return (
    allCheckersInHome(state, color) && allCheckersAccountedInHome(state, color)
  );
}

/**
 * The farthest point from the bear-off in `color`'s home board that still has checkers.
 * For white (home 0–5): returns the highest index with a checker (closest to point 5).
 * For black (home 18–23): returns the lowest index with a checker (closest to point 18).
 * Used to enforce the "must use higher dice on farthest checker" rule.
 */
function farthestOccupiedHomePoint(state: GameState, color: Color): number {
  const { start, end } = HOME[color];
  if (color === "white") {
    for (let i = end; i >= start; i--) {
      if (state.points[i] > 0) return i;
    }
  } else {
    for (let i = start; i <= end; i++) {
      if (state.points[i] < 0) return i;
    }
  }
  return -1;
}

/** Distance from a point to the bear-off for `color`. */
function distanceToBearOff(point: number, color: Color): number {
  return color === "white" ? point + 1 : BOARD_SIZE - point;
}

/** The entry point index when re-entering from the bar with die value `die`. */
function barEntryPoint(die: number, color: Color): number {
  return color === "white" ? BOARD_SIZE - die : die - 1;
}

// ============================================================
// Board setup
// ============================================================

/**
 * Standard Backgammon starting position.
 *
 *  White (positive)   Black (negative)
 *  ───────────────── ─────────────────
 *  point 23: 2       point 0: -2
 *  point 12: 5       point 11: -5
 *  point 7:  3       point 16: -3
 *  point 5:  5       point 18: -5
 */
export function initialBoard(): number[] {
  const points = new Array(BOARD_SIZE).fill(0);
  points[23] = 2; // white
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2; // black
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return points;
}

export function newGame(): GameState {
  return {
    points: initialBoard(),
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    dice: [],
    remaining: [],
    phase: "opening_roll",
    cube: 1,
    cubeOwner: "center",
    doublingEnabled: true,
    doubleOfferedBy: null,
    winner: null,
    winType: null,
    openingRoll: { white: null, black: null },
    lastMove: null,
    moveHistory: null,
    message: "Roll to start",
    
  };
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    points: [...state.points],
    bar: { ...state.bar },
    home: { ...state.home },
    dice: [...state.dice],
    remaining: [...state.remaining],
    openingRoll: { ...state.openingRoll },
    lastMove: state.lastMove
      ? state.lastMove.map((move) => ({ ...move }))
      : null,
    moveHistory: state.moveHistory ? [...state.moveHistory] : null,
  };
}

// ============================================================
// Dice
// ============================================================

export function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

/**
 * Roll two dice. If doubles, return all four values (e.g. [5,5,5,5]).
 * This lets the caller know how many times each die value can be used.
 */
export function rollDice(): number[] {
  const first = rollDie();
  const second = rollDie();
  return orderedDice(first, second);
}

function orderedDice(first: number, second: number): number[] {
  if (first === second) return [first, first, first, first];
  return first > second ? [first, second] : [second, first];
}

export function reorderDice(state: GameState): GameState {
  if (state.phase !== "moving" || state.remaining.length < 2) return state;
  const next = cloneState(state);
  next.remaining.reverse();
  return next;
}

// ============================================================
// Legal move calculation
// ============================================================

/**
 * All legal moves from a single source point for `color`.
 * `from` can be a board index (0–23) or BAR for re-entry.
 */
export function legalMovesFrom(
  state: GameState,
  from: Source,
  color: Color,
): Move[] {
  const moves: Move[] = [];
  // Deduplicate: if you rolled [6,6,6,6], we only check "6" once.
  const uniqueDice = Array.from(new Set(state.remaining));
  const direction = stepDirection(color);

  // Rule: if any checkers are on the bar, you MUST re-enter first.
  if (state.bar[color] > 0 && from !== BAR) return [];

  // --- Re-entry from bar ---
  if (from === BAR) {
    for (const die of uniqueDice) {
      const entryPoint = barEntryPoint(die, color);
      if (entryPoint < 0 || entryPoint >= BOARD_SIZE) continue;
      if (!isOpponentBlockade(state, entryPoint, color)) {
        moves.push({ from: BAR, to: entryPoint, die });
      }
    }
    return moves;
  }

  // Rule: can only move your own checkers.
  if (!isOwnedBy(state, from, color)) return [];

  // --- Normal move or bear-off ---
  for (const die of uniqueDice) {
    const destination = from + direction * die;
    const isOffBoard = destination < 0 || destination >= BOARD_SIZE;

    if (!isOffBoard) {
      // Normal move: destination must not be blocked by opponent.
      if (!isOpponentBlockade(state, destination, color)) {
        moves.push({ from, to: destination, die });
      }
    } else {
      // Bearing off — only allowed when all checkers are in home.
      if (!canBearOff(state, color)) continue;

      const distance = distanceToBearOff(from, color);

      if (die === distance) {
        // Exact die match — always allowed.
        moves.push({ from, to: OFF, die });
      } else if (die > distance) {
        // Over-die: only allowed if this checker is the farthest from home.
        const farthest = farthestOccupiedHomePoint(state, color);
        if (from === farthest) {
          moves.push({ from, to: OFF, die });
        }
      }
    }
  }

  return moves;
}

/** All legal moves available to `color` in the current state. */
export function allLegalMoves(state: GameState, color: Color): Move[] {
  const allMoves: Move[] = [];

  // If on bar, the only legal moves are re-entries.
  if (state.bar[color] > 0) {
    return legalMovesFrom(state, BAR, color);
  }

  // Collect moves from every owned point.
  for (let point = 0; point < BOARD_SIZE; point++) {
    if (isOwnedBy(state, point, color)) {
      allMoves.push(...legalMovesFrom(state, point, color));
    }
  }

  return allMoves;
}

/**
 * If `color` has exactly one legal placement available, return a matching
 * move. Otherwise return null. Multiple dice that land on the same point
 * (e.g. bearing off with either die) still count as a single placement.
 */
export function getForcedMove(
  state: GameState,
  color: Color,
): Move | null {
  const moves = allLegalMoves(state, color);
  const placements = new Set(moves.map((m) => `${m.from}->${m.to}`));
  if (placements.size !== 1) return null;
  return moves[0];
}

// ============================================================
// Apply a single move
// ============================================================

/**
 * Apply a validated move and return a new GameState.
 * Does NOT validate the turn — caller is responsible for that.
 * This function:
 *   1. Removes the used die from `remaining`
 *   2. Moves the checker from source to destination
 *   3. Handles blot capture (opponent checker → bar)
 *   4. Checks for win conditions
 *   5. Auto-passes the turn if no legal moves remain
 */
export function applyMove(
  state: GameState,
  move: Move,
  color: Color,
): GameState {
  const next = cloneState(state);
  const opponentColor = opponent(color);

  // Save pre-move snapshot for undo
  next.moveHistory = [...(next.moveHistory ?? []), cloneState(state)];

  // --- Consume the die ---
  const dieIndex = next.remaining.indexOf(move.die);
  if (dieIndex >= 0) next.remaining.splice(dieIndex, 1);

  // --- Remove checker from source ---
  if (move.from === BAR) {
    next.bar[color] -= 1;
  } else {
    next.points[move.from] += color === "white" ? -1 : 1;
  }

  // --- Place checker at destination ---
  if (move.to === OFF) {
    // Bear off — move to home tally.
    next.home[color] += 1;
  } else {
    // Capture opponent blot if present.
    if (isOpponentBlot(next, move.to, color)) {
      next.points[move.to] = 0;
      next.bar[opponentColor] += 1;
    }
    // Land the checker.
    next.points[move.to] += color === "white" ? 1 : -1;
  }

  // --- Track the move ---
  next.lastMove = [...(next.lastMove ?? []), { from: move.from, to: move.to }];

  // --- Check win: all 15 checkers borne off ---
  if (next.home[color] === TOTAL_CHECKERS) {
    return applyWin(next, color);
  }

  // --- End turn if no dice remain (needs player confirm) ---
  if (next.remaining.length === 0) {
    next.phase = "moving";
    next.message = `${next.turn === "white" ? "White" : "Black"} — confirm end of turn`;
    return next;
  }

  // --- Auto-pass if no legal moves with remaining dice ---
  if (allLegalMoves(next, color).length === 0) {
    return passTurn(next, color);
  }

  return next;
}

// ============================================================
// Apply a full dice roll
// ============================================================

/**
 * Roll the dice and set the phase to "moving".
 * If the roll produces zero legal moves, the turn auto-passes.
 * Pass `customDice` to override randomness (for testing or remote play).
 */
export function applyRoll(state: GameState, customDice?: number[]): GameState {
  const next = cloneState(state);
  const roll = customDice
    ? orderedDice(customDice[0], customDice[1])
    : rollDice();

  // For display: show [a, b] (or [a, a] for doubles).
  // For remaining: store all values (e.g. [6,6,6,6] for double 6s).
  if (roll.length === 4) {
    next.dice = [roll[0], roll[0]];
  } else {
    next.dice = [roll[0], roll[1]];
  }
  next.remaining = roll;
  next.phase = "moving";
  next.lastMove = [];
  next.moveHistory = [];

  // If there are no legal moves with this roll, stay in "moving" phase
  // and keep `dice` so the UI can show the result before auto-passing.
  if (allLegalMoves(next, next.turn).length === 0) {
    next.phase = "moving";
    next.message = "No legal moves";
    return next;
  }

  next.message = `${next.turn === "white" ? "White" : "Black"} — make a move`;
  return next;
}

// ============================================================
// Opening roll
// ============================================================

/**
 * Roll one die for a player during the opening roll phase.
 * Once both players have rolled:
 *   - Higher roll wins and becomes the first turn.
 *   - Tie → both roll again.
 */
export function applyOpeningRoll(state: GameState, color: Color, customDie?: number): GameState {
  const next = cloneState(state);

  // Already rolled — ignore.
  if (next.openingRoll[color] !== null) return next;

  next.openingRoll[color] = customDie ?? rollDie();

  // If only one player has rolled, hand the dice to the other player.
  if (next.openingRoll.white === null || next.openingRoll.black === null) {
    next.turn = color === "white" ? "black" : "white";
    next.message = "Waiting for opponent's roll";
    return next;
  }

  // Both have rolled.
  const whiteRoll = next.openingRoll.white!;
  const blackRoll = next.openingRoll.black!;

  if (whiteRoll === blackRoll) {
    // Tie — reset and try again, starting with white.
    next.openingRoll = { white: null, black: null };
    next.turn = "white";
    next.message = "Tie — roll again";
    return next;
  }

  // Determine winner and set the game in motion.
  const firstPlayer: Color = whiteRoll > blackRoll ? "white" : "black";
  const openingDice = orderedDice(whiteRoll, blackRoll);
  next.turn = firstPlayer;
  next.dice = openingDice;
  next.remaining = openingDice;
  next.phase = "opening_result";
  next.lastMove = [];
  next.moveHistory = [];
  next.message = `${firstPlayer === "white" ? "White" : "Black"} starts`;
  return next;
}

// ============================================================
// Doubling cube
// ============================================================

export function offerDouble(state: GameState, color: Color): GameState {
  const next = cloneState(state);
  if (next.doublingEnabled === false) return next;
  next.phase = "doubling_offered";
  next.doubleOfferedBy = color;
  next.message = `${color === "white" ? "White" : "Black"} offers a double`;
  return next;
}

export function respondDouble(state: GameState, accept: boolean): GameState {
  const next = cloneState(state);
  const offerer = next.doubleOfferedBy!;
  const responder = opponent(offerer);

  if (accept) {
    next.cube *= 2;
    next.cubeOwner = responder;
    next.phase = next.dice.length === 0 ? "rolling" : "moving";
    next.doubleOfferedBy = null;
    next.message = `Double accepted — cube is ${next.cube}`;
  } else {
    // Declining the double forfeits the game.
    next.winner = offerer;
    next.winType = "single";
    next.phase = "game_over";
    next.doubleOfferedBy = null;
    next.message = `${responder === "white" ? "White" : "Black"} declined — ${offerer === "white" ? "White" : "Black"} wins`;
  }

  return next;
}

// ============================================================
// Undo
// ============================================================

/**
 * Undo the last move of the current turn.
 * Returns the state before the most recent move, or null if there's nothing to undo.
 * Only valid during the "moving" phase of the player who made the move.
 */
export function undoLastMove(state: GameState): GameState | null {
  if (!state.moveHistory || state.moveHistory.length === 0) return null;
  const prev = state.moveHistory[state.moveHistory.length - 1];
  const restored = cloneState(prev);
  restored.moveHistory = state.moveHistory.slice(0, -1);
  return restored;
}

export function canOfferDouble(state: GameState, color: Color): boolean {
  return (
    state.phase === "rolling" &&
    state.turn === color &&
    state.doublingEnabled !== false &&
    (state.cubeOwner === "center" || state.cubeOwner === color) &&
    state.cube < CUBE_MAX
  );
}

// ============================================================
// Scoring
// ============================================================

/** Points awarded for the current game (cube value × win type multiplier). */
export function pointsForWin(state: GameState): number {
  if (!state.winType) return 0;
  const multiplier =
    state.winType === "single" ? 1 : state.winType === "gammon" ? 2 : 3;
  return multiplier * state.cube;
}

// ============================================================
// Internal helpers
// ============================================================

/** Handle a win — determine win type (single / gammon / backgammon). */
function applyWin(state: GameState, winner: Color): GameState {
  state.winner = winner;
  const loser = opponent(winner);

  if (state.home[loser] === 0) {
    // Opponent hasn't borne off any checkers — gammon or backgammon.
    const loserOnBar = state.bar[loser] > 0;
    const loserInWinnerHome = hasCheckersInRange(
      state,
      loser,
      HOME[winner].start,
      HOME[winner].end,
    );
    state.winType = loserOnBar || loserInWinnerHome ? "backgammon" : "gammon";
  } else {
    state.winType = "single";
  }

  state.phase = "game_over";
  state.message = "Game over";
  return state;
}

/** Check if `color` has any checkers in the given point range. */
function hasCheckersInRange(
  state: GameState,
  color: Color,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  for (let i = rangeStart; i <= rangeEnd; i++) {
    if (isOwnedBy(state, i, color)) return true;
  }
  return false;
}

/** End the current turn: clear dice, switch to opponent, set phase to "rolling". */
function passTurn(state: GameState, currentPlayer: Color): GameState {
  const nextPlayer = opponent(currentPlayer);
  state.remaining = [];
  state.dice = [];
  state.phase = "rolling";
  state.lastMove = null;
  state.moveHistory = null;
  state.turn = nextPlayer;
  state.message = `${nextPlayer === "white" ? "White" : "Black"}'s turn`;
  return state;
}
