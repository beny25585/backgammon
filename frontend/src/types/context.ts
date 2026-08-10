import type { GameState, Color } from "./game";
import type { Source, Target } from "../lib/backgammon/engine";
import type { TimeControl } from "../lib/clock";

export interface OpeningRollResult {
  myDie: number | null;
  opponentDie: number | null;
  winner: Color | null;
}

export interface GameResult {
  winner: Color;
  winType: "single" | "gammon" | "backgammon";
  points: number;
  cube: number;
  matchScore: Record<Color, number>;
  targetPoints: number;
  matchOver?: boolean;
  reason?: string;
}

export interface GameContextType {
  state: GameState | null;
  playerColor: Color;
  whiteName: string | null;
  blackName: string | null;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  openingRollResult: OpeningRollResult | null;
  setOpeningRollResult: (result: OpeningRollResult | null) => void;
  reconnected: boolean;
  opponentConnected: boolean;
  timeControl: TimeControl | null;
  clock: Record<Color, number> | null;
  turnStartedAt: number | null;
  gameResult: GameResult | null;
  nextGameCountdown: number | null;
  matchScore: Record<Color, number> | null;
  handleNextGame: () => void;
  handleHome: () => void;
  updateState: (newState: GameState) => void;
  makeMove: (from: Source, to: Target) => void;
  rollDice: () => void;
  offerDouble: () => void;
  respondToDouble: (accept: boolean) => void;
  endTurn: () => void;
  undoMove: () => void;
  giveUp: () => void;
  leaveGame: () => void;
  noMovesMessage: { dice: number[] } | null;
}
