/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { GameContext } from "../services/gameContext";
import { makeMockContext, makeGameState } from "./gameState";
import type { GameContextType } from "../types/context";
import type { GameState, Color } from "../types/game";

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
