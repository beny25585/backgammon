import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { GameContext } from "../services/gameContext";
import { newGame } from "../lib/backgammon/engine";
import type { GameContextType } from "../types/context";
import type { GameState, Color } from "../types/game";

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...overrides };
}

export function makeMockContext(overrides: Partial<GameContextType> = {}): GameContextType {
  return {
    state: makeGameState(),
    playerColor: "white",
    isLoading: false,
    error: null,
    openingRollResult: null,
    setOpeningRollResult: () => {},
    reconnected: false,
    opponentConnected: true,
    gameResult: null,
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

interface MockGameWrapperProps {
  children: ReactNode;
  context?: Partial<GameContextType>;
  playerColor?: Color;
  state?: Partial<GameState>;
}

export function MockGameWrapper({ children, context, playerColor, state }: MockGameWrapperProps) {
  const ctx = makeMockContext({
    playerColor: playerColor ?? "white",
    state: makeGameState(state),
    ...context,
  });
  return (
    <MemoryRouter>
      <GameContext.Provider value={ctx}>{children}</GameContext.Provider>
    </MemoryRouter>
  );
}
