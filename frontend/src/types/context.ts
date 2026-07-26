import type { GameState, Color } from "./game";
import type { Source, Target } from "../lib/backgammon/engine";

export interface OpeningRollResult {
  myDie: number | null;
  opponentDie: number | null;
  winner: Color | null;
}

export interface GameContextType {
  state: GameState | null;
  playerColor: Color;
  isLoading: boolean;
  error: string | null;
  openingRollResult: OpeningRollResult | null;
  setOpeningRollResult: (result: OpeningRollResult | null) => void;
  reconnected: boolean;
  opponentConnected: boolean;
  gameResult: {
    winner: Color;
    winType: "single" | "gammon" | "backgammon";
    points: number;
    cube: number;
    matchScore: Record<Color, number>;
  } | null;
  handleNextGame: () => void;
  handleHome: () => void;
  updateState: (newState: GameState) => void;
  makeMove: (from: Source, to: Target) => void;
  rollDice: () => void;
  offerDouble: () => void;
  respondToDouble: (accept: boolean) => void;
  endTurn: () => void;
  undoMove: () => void;
}
