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

export function GameOverProbe() {
  const { updateState } = useGame();
  useEffect(() => {
    updateState(gameOverFixture);
  }, [updateState]);
  return null;
}
