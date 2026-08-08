import { useEffect } from "react";
import { useGame } from "../services/gameContext";
import { newGame } from "../lib/backgammon/engine";
import { gameOverFixture } from "./fixtures";

export function ClockProbe() {
  const { clock, turnStartedAt } = useGame();
  return <div>{`clock:${JSON.stringify(clock)},started:${turnStartedAt}`}</div>;
}

export function StartMidGame() {
  const { updateState } = useGame();
  useEffect(() => {
    updateState({ ...newGame(), phase: "moving", turn: "white", dice: [1, 1], remaining: [1, 1] });
  }, [updateState]);
  return <div />;
}

export function SeedRolling() {
  const { updateState } = useGame();
  useEffect(() => {
    updateState({ ...newGame(), phase: "rolling", turn: "white", dice: [], remaining: [] });
  }, [updateState]);
  return <div />;
}

export function SeedRollingBot() {
  const { updateState } = useGame();
  useEffect(() => {
    updateState({ ...newGame(), phase: "rolling", turn: "black", dice: [], remaining: [] });
  }, [updateState]);
  return <div />;
}

export function GameProbe({ from, to }: { from: number; to: number }) {
  const {
    state,
    makeMove,
    undoMove,
    rollDice,
    openingRollResult,
    noMovesMessage,
    isLoading,
    error,
    gameResult,
    handleNextGame,
  } = useGame();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="version">{String(state?.version ?? "")}</div>
      <div data-testid="phase">{String(state?.phase ?? "")}</div>
      <div data-testid="dice">{JSON.stringify(state?.dice ?? [])}</div>
      <div data-testid="opening-result">{JSON.stringify(openingRollResult)}</div>
      <div data-testid="no-moves">{String(Boolean(noMovesMessage))}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="game-result">
        {JSON.stringify(gameResult ? { winner: gameResult.winner } : null)}
      </div>
      <button data-testid="move" onClick={() => makeMove(from, to)}>
        move
      </button>
      <button data-testid="undo" onClick={() => undoMove()}>
        undo
      </button>
      <button data-testid="roll" onClick={() => rollDice()}>
        roll
      </button>
      <button data-testid="next" onClick={handleNextGame}>
        next
      </button>
    </div>
  );
}

export function GameOverProbe() {
  const { updateState } = useGame();
  useEffect(() => {
    updateState(gameOverFixture);
  }, [updateState]);
  return null;
}
