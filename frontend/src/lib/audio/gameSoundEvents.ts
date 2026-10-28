import type { Color, GameState } from "../backgammon/engine";

export type GameSound = "roll" | "move" | "hit" | "undo" | "confirm" | "double" | "win" | "bearOff";

export interface GameSoundSnapshot {
  state: GameState | null;
  roomId?: string;
  playerColor: Color;
  matchScore: Record<Color, number> | null;
  isLoading: boolean;
  reconnected: boolean;
  connectionEpoch?: number;
}

export function isGameSoundBoundary(previous: GameSoundSnapshot, next: GameSoundSnapshot): boolean {
  return !next.state || !previous.state || previous.roomId !== next.roomId ||
    (Boolean(next.roomId) && previous.playerColor !== next.playerColor) ||
    previous.isLoading || next.isLoading || (!previous.reconnected && next.reconnected) ||
    (previous.connectionEpoch ?? 0) !== (next.connectionEpoch ?? 0);
}

/** Return one cue for a live transition; snapshots and result enrichment stay silent. */
export function getGameSound(previous: GameSoundSnapshot, next: GameSoundSnapshot): GameSound | null {
  const before = previous.state;
  const state = next.state;
  if (!state || !before || isGameSoundBoundary(previous, next)) return null;

  const winner = state.winner;
  // The score is updated by game_ended online (and the result calculation locally).
  // An optimistic final checker move alone must never trigger a celebration.
  if (state.phase === "game_over" && winner && previous.matchScore && next.matchScore &&
    next.matchScore[winner] > previous.matchScore[winner] &&
    winner === next.playerColor) return "win";

  if (state.phase === "doubling_offered" && state.doubleOfferedBy &&
    (before.phase !== "doubling_offered" || before.doubleOfferedBy !== state.doubleOfferedBy)) return "double";

  // A hit or bear-off may also end the turn, clearing lastMove on the server.
  const hit = (state.bar.white > before.bar.white || state.bar.black > before.bar.black) &&
    state.points.some((point, index) => Math.abs(before.points[index]) === 1 &&
      point === -before.points[index]);
  if (hit) return "hit";

  if (state.home.white > before.home.white || state.home.black > before.home.black) return "bearOff";

  const openingRolled = (["white", "black"] as const).some(
    (color) => before.openingRoll[color] === null && state.openingRoll[color] !== null,
  );
  const rolled = before.phase === "rolling" && state.phase === "moving" && state.dice.length > 0;
  if (openingRolled || rolled) return "roll";

  if ((state.lastMove?.length ?? 0) > (before.lastMove?.length ?? 0) &&
    state.points.some((point, index) => point !== before.points[index])) return "move";

  return null;
}
