import { newGame } from "../lib/backgammon/engine";
import type { GameContextType } from "../types/context";
import type { GameState } from "../types/game";

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...overrides };
}

export function makeMockContext(overrides: Partial<GameContextType> = {}): GameContextType {
  return {
    state: makeGameState(),
    playerColor: "white",
    whiteName: null,
    blackName: null,
    isLoading: false,
    error: null,
    openingRollResult: null,
    setOpeningRollResult: () => {},
    reconnected: false,
    opponentConnected: true,
    timeControl: null,
    clock: null,
    turnStartedAt: null,
    gameResult: null,
    matchScore: null,
    handleNextGame: () => {},
    handleHome: () => {},
    updateState: () => {},
    makeMove: () => {},
    rollDice: () => {},
    offerDouble: () => {},
    respondToDouble: () => {},
    endTurn: () => {},
    undoMove: () => {},
    giveUp: () => {},
    noMovesMessage: null,
    ...overrides,
  };
}
