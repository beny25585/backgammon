import { useCallback, useEffect, useState } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import GameResultOverlay from "../GameResultOverlay/GameResultOverlay";
import { RollPrompt } from "../Dice";
import { useAutoRoll } from "../autoRoll/AutoRoll";
import { clientLogger } from "@/services/logger";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const {
    state,
    playerColor,
    isLoading,
    error,
    clearError,
    makeMove,
    rollDice,
    reconnected,
    opponentConnected,
    undoMove,
    endTurn,
    respondToDouble,
    clock,
    turnStartedAt,
    timeControl,
    gameResult,
    whiteName,
    blackName,
    handleNextGame,
    handleHome,
  } = useGame();

  const [rollResult, setRollResult] = useState<number[] | undefined>(undefined);
  const [landing, setLanding] = useState(false);
  const [autoRoll, setAutoRoll] = useAutoRoll();

  const handleRoll = useCallback(() => {
    setRollResult(undefined);
    setLanding(true);
    rollDice();
  }, [rollDice]);

  const handleOpeningRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  useEffect(() => {
    // Once the server delivers dice during the roll, feed them to the prompt.
    if (landing && state?.phase === "moving" && state.dice.length > 0) {
      setRollResult(state.dice);
    }
  }, [landing, state?.phase, state?.dice]);

  useEffect(() => {
    if (!autoRoll) return;
    if (!state) return;
    if (state.turn !== playerColor) return;
    clientLogger.debug("[autoRoll] effect fired", {
      phase: state.phase,
      turn: state.turn,
      playerColor,
      remaining: state.remaining,
    });
    if (state.phase === "opening_roll") {
      handleOpeningRoll();
    } else if (state.phase === "rolling" && state.remaining.length === 0) {
      rollDice();
    }
  }, [autoRoll, state, playerColor, handleOpeningRoll, rollDice]);

  const handleRollLand = useCallback(() => {
    setLanding(false);
    setRollResult(undefined);
  }, []);

  const isOpeningRoll = state?.phase === "opening_roll";
  const needsToRoll =
    (state?.phase === "rolling" &&
      state?.remaining.length === 0 &&
      state?.turn === playerColor) ||
    (landing && state?.turn === playerColor);

  if (isLoading) {
    return <div className={styles.loading}>Connecting to game...</div>;
  }

  if (!state) {
    if (error) {
      return <div className={styles.error}>Error: {error}</div>;
    }
    return <div className={styles.loading}>Initializing game...</div>;
  }

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorCard} data-testid="error-card" role="alert">
          <span>Error: {error}</span>
          <button
            type="button"
            className={styles.errorCardClose}
            data-testid="error-card-close"
            aria-label="Dismiss error"
            onClick={clearError}
          >
            ✕
          </button>
        </div>
      )}

      {gameResult && (
        <GameResultOverlay
          playerColor={playerColor}
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={gameResult.matchScore}
          matchTarget={gameResult.targetPoints}
          matchOver={gameResult.matchOver}
          reason={gameResult.reason}
          whiteName={whiteName}
          blackName={blackName}
          onNext={handleNextGame}
          onHome={onLeave || handleHome}
        />
      )}

      {!gameResult && (
        <>
          {reconnected && <div className={styles.reconnected}>Reconnected</div>}
          {!opponentConnected && !reconnected && (
            <div className={styles.disconnected}>
              Opponent disconnected — you can keep playing
            </div>
          )}

          <GameBoard
            state={state}
            playerColor={playerColor}
            makeMove={makeMove}
            undoMove={undoMove}
            endTurn={endTurn}
            autoRoll={autoRoll}
            onAutoRollChange={setAutoRoll}
            needsToRoll={needsToRoll}
            onRoll={handleRoll}
            rollResult={rollResult}
            onRollLand={handleRollLand}
            landing={landing}
            respondToDouble={respondToDouble}
            onLeave={onLeave}
            clock={clock}
            turnStartedAt={turnStartedAt}
            timeControl={timeControl}
          />
        </>
      )}

      {isOpeningRoll && state.turn === playerColor && !autoRoll && (
        <div className={styles.overlayDim}>
          <div className={styles.overlayCard}>
            <RollPrompt
              onRoll={handleOpeningRoll}
              isOpening
              dark={playerColor === "black"}
            />
          </div>
        </div>
      )}
    </div>
  );
}
