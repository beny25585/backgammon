import { test, expect } from "@playwright/experimental-ct-react";
import { GameContext } from "./gameContext";
import GameScreen from "../components/GameScreen/GameScreen";
import type { GameState } from "../lib/backgammon/engine";
import { newGame } from "../lib/backgammon/engine";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...overrides } as GameState;
}

function makeGameResult(overrides: Record<string, unknown> = {}) {
  return {
    winner: "white" as const,
    winType: "single" as const,
    points: 1,
    cube: 1,
    matchScore: { white: 1, black: 0 },
    targetPoints: 9,
    matchOver: false,
    reason: "move",
    gameType: "1v1" as const,
    ...overrides,
  };
}

test("non-final game does not show final GameResult overlay", async ({ mount }) => {
  const state = makeState({ phase: "game_over", winner: "white", winType: "single" });
  const gameResult = makeGameResult({ matchOver: false, matchScore: { white: 2, black: 1 } });
  const component = await mount(
    <GameContext.Provider
      value={{
        state,
        playerColor: "white",
        whiteName: "Alice",
        blackName: "Bob",
        isLoading: false,
        error: null,
        clearError: () => {},
        openingRollResult: null,
        setOpeningRollResult: () => {},
        reconnected: false,
        opponentConnected: true,
        timeControl: { base: 540000, delay: 10000 },
        clock: { white: 222000, black: 251000 },
        turnStartedAt: null,
        gameResult: gameResult as never,
        nextGameCountdown: null,
        matchScore: { white: 2, black: 1 },
        autoConfirmPending: false,
        gameType: "1v1",
        handleNextGame: () => {},
        handleHome: () => {},
        updateState: () => {},
        makeMove: () => {},
        rollDice: () => {},
        reorderDice: () => {},
        offerDouble: () => {},
        respondToDouble: () => {},
        endTurn: () => {},
        undoMove: () => {},
        giveUp: () => {},
        leaveGame: () => {},
        noMovesMessage: null,
        rematchState: { status: "available" },
        requestRematch: () => {},
        acceptRematch: () => {},
        declineRematch: () => {},
        cancelRematch: () => {},
      }}
    >
      <GameScreen />
    </GameContext.Provider>
  );
  // Board should be visible, final overlay should not
  await expect(component.getByText("Match Result")).not.toBeVisible();
  await expect(component.locator('[data-testid="score-white"]')).not.toBeVisible();
});

test("final game shows base GameResult", async ({ mount }) => {
  const state = makeState({ phase: "game_over", winner: "white" });
  const gameResult = makeGameResult({ matchOver: true, matchScore: { white: 9, black: 1 } });
  const component = await mount(
    <GameContext.Provider
      value={{
        state,
        playerColor: "white",
        whiteName: "Alice",
        blackName: "Bob",
        isLoading: false,
        error: null,
        clearError: () => {},
        openingRollResult: null,
        setOpeningRollResult: () => {},
        reconnected: false,
        opponentConnected: true,
        timeControl: { base: 540000, delay: 10000 },
        clock: { white: 10000, black: 10000 },
        turnStartedAt: null,
        gameResult: gameResult as never,
        nextGameCountdown: null,
        matchScore: { white: 9, black: 1 },
        autoConfirmPending: false,
        gameType: "1v1",
        handleNextGame: () => {},
        handleHome: () => {},
        updateState: () => {},
        makeMove: () => {},
        rollDice: () => {},
        reorderDice: () => {},
        offerDouble: () => {},
        respondToDouble: () => {},
        endTurn: () => {},
        undoMove: () => {},
        giveUp: () => {},
        leaveGame: () => {},
        noMovesMessage: null,
        rematchState: { status: "available" },
        requestRematch: () => {},
        acceptRematch: () => {},
        declineRematch: () => {},
        cancelRematch: () => {},
      }}
    >
      <GameScreen />
    </GameContext.Provider>
  );
  await expect(component.getByText("Match Result")).toBeVisible();
  await expect(component.getByText("Alice")).toBeVisible();
});
