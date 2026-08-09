import { useCallback, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import GameResultOverlay from "../GameResultOverlay/GameResultOverlay";
import { DiceRow, RollPrompt } from "../Dice";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const {
    state,
    playerColor,
    isLoading,
    error,
    makeMove,
    rollDice,
    openingRollResult,
    setOpeningRollResult,
    reconnected,
    opponentConnected,
    undoMove,
    endTurn,
    noMovesMessage,
    clock,
    turnStartedAt,
    timeControl,
    gameResult,
    whiteName,
    blackName,
    handleNextGame,
    handleHome,
  } = useGame();

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  const isOpeningRoll = state?.phase === "opening_roll";
  const isOpeningResult = state?.phase === "opening_result";
  const needsToRoll =
    state?.phase === "rolling" &&
    state?.remaining.length === 0 &&
    state?.turn === playerColor;

  useEffect(() => {
    if (
      state &&
      state.phase !== "opening_roll" &&
      state.phase !== "opening_result" &&
      openingRollResult !== null
    ) {
      setOpeningRollResult(null);
    }
  }, [state, openingRollResult, setOpeningRollResult]);

  if (isLoading) {
    return <div className={styles.loading}>Connecting to game...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  if (!state) {
    return <div className={styles.loading}>Initializing game...</div>;
  }

  return (
    <div className={styles.container}>
      {gameResult && (
        <GameResultOverlay
          playerColor={playerColor}
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={gameResult.matchScore}
          matchTarget={gameResult.targetPoints}
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
            onLeave={onLeave}
            needsToRoll={needsToRoll}
            onRoll={handleRoll}
            clock={clock}
            turnStartedAt={turnStartedAt}
            timeControl={timeControl}
          />
        </>
      )}

      {(isOpeningRoll || isOpeningResult) &&
        (() => {
          const orr = openingRollResult;

          if (isOpeningResult && orr) {
            return (
              <div className={styles.overlayDim}>
                <div className={styles.overlayCard} data-testid="opening-result-overlay">
                  <div style={{ marginBottom: "0.75rem" }}>
                    <DiceRow
                      dice={[]}
                      remaining={[]}
                      color={playerColor}
                      showLabels
                      myRoll={orr.myDie}
                      opponentRoll={orr.opponentDie}
                      winner={orr.winner}
                    />
                  </div>
                  {orr.winner === playerColor && (
                    <div className={styles.winnerText}>You go first!</div>
                  )}
                  {orr.winner && orr.winner !== playerColor && (
                    <div className={styles.subText}>Opponent goes first</div>
                  )}
                </div>
              </div>
            );
          }

          if (isOpeningRoll && orr?.myDie != null) {
            return (
              <div className={styles.overlayDim}>
                <div className={styles.overlayCard}>
                  <div style={{ marginBottom: "0.75rem" }}>
                    <DiceRow
                      dice={[]}
                      remaining={[]}
                      color={playerColor}
                      showLabels
                      myRoll={orr.myDie}
                    />
                  </div>
                  <div className={styles.mutedText}>
                    Waiting for opponent...
                  </div>
                </div>
              </div>
            );
          }

          if (isOpeningRoll && state.turn === playerColor) {
            return (
              <div className={styles.overlayDim}>
                <div className={styles.overlayCard}>
                  <RollPrompt
                    onRoll={handleRoll}
                    isOpening
                    dark={playerColor === "black"}
                  />
                </div>
              </div>
            );
          }

          if (isOpeningRoll) {
            return (
              <div className={styles.overlayDim}>
                <div className={styles.overlayCard}>
                  <div className={styles.mutedText}>
                    Waiting for opponent to roll...
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })()}

      {noMovesMessage && (
        <div className={styles.overlayDim}>
          <div className={styles.overlayCard}>
            <div style={{ marginBottom: "0.75rem" }}>
              <DiceRow
                dice={noMovesMessage.dice}
                remaining={[]}
                color={playerColor}
              />
            </div>
            <div className={styles.mutedText}>No moves available</div>
          </div>
        </div>
      )}
    </div>
  );
}
