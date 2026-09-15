import type { GameState, Color } from "./game";
import type { Source, Target } from "../lib/backgammon/engine";
import type { TimeControl } from "../lib/clock";

export interface OpeningRollResult {
  myDie: number | null;
  opponentDie: number | null;
  winner: Color | null;
}

export type GameType = "tournament" | "1v1" | "quick" | "local";

export interface TournamentProgress {
  roundLabel?: string;
  roundResult?: string;
  advancement?: "advanced" | "eliminated" | "pending";
  nextOpponent?: string | null;
  nextMatchLabel?: string | null;
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
  adminReason?: string;
  gameType?: GameType;
  tournament?: TournamentProgress | null;
  ratingChange?: number | null;
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  opponentRatingBefore?: number | null;
  opponentRatingAfter?: number | null;
  opponentRatingChange?: number | null;
  hits?: number | null;
  doublesOffered?: number | null;
  doublesAccepted?: number | null;
  openingRoll?: Partial<Record<Color, number>> | null;
  firstPlayer?: Color | null;
  durationSeconds?: number | null;
  clockRemaining?: Partial<Record<Color, number>> | null;
  coinsReward?: string | null;
  coinsChange?: number | null;
  opponentCoinsChange?: number | null;
  stakeAmount?: number | null;
  errorRate?: number | null;
  luckLabel?: string | null;
}

export interface NoMovesMessage {
  dice: number[];
  remaining: number[];
  color: Color;
  noticeVisible?: boolean;
}

export type RematchStatus =
  | "idle"
  | "available"
  | "requested"
  | "offered"
  | "creating"
  | "unavailable";

export interface RematchState {
  status: RematchStatus;
  reason?: string | null;
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
  gameType: GameType;
  handleNextGame: () => void;
  handleHome: () => void;
  updateState: (newState: GameState) => void;
  makeMove: (from: Source, to: Target) => void;
  rollDice: () => void;
  reorderDice: () => void;
  offerDouble: () => void;
  respondToDouble: (accept: boolean) => void;
  endTurn: () => void;
  undoMove: () => void;
  giveUp: () => void;
  leaveGame: () => void;
  noMovesMessage: NoMovesMessage | null;
  rematchState: RematchState;
  requestRematch: () => void;
  acceptRematch: () => void;
  declineRematch: () => void;
  cancelRematch: () => void;
}
