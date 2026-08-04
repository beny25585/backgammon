import { useCallback, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import { DiceRow, RollPrompt } from "../Dice";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const { state, playerColor, isLoading, error, makeMove, rollDice, openingRollResult, setOpeningRollResult, reconnected, opponentConnected, undoMove, endTurn, noMovesMessage, clock, turnStartedAt, timeControl } = useGame();

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  const isOpeningRoll = state?.phase === "opening_roll";
  const isMyTurnToRoll = isOpeningRoll && state?.turn === playerColor;
  const iRolled = isOpeningRoll && openingRollResult?.myDie != null;
  const bothRolled = openingRollResult?.myDie != null && openingRollResult?.opponentDie != null;
  const needsToRoll = state?.phase === "rolling" && state?.dice.length === 0 && state?.turn === playerColor;

  useEffect(() => {
    if (state && state.phase !== "opening_roll" && openingRollResult !== null) {
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
      {reconnected && (
        <div className={styles.reconnected}>
          Reconnected
        </div>
      )}
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

      {isOpeningRoll && (() => {
        const orr = openingRollResult;
        return (
          <div className={styles.overlayDim}>
            <div className={styles.overlayCard}>
              {isMyTurnToRoll && !iRolled ? (
                <RollPrompt onRoll={handleRoll} isOpening dark={playerColor === "black"} />
              ) : bothRolled && orr ? (
                <>
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
                </>
              ) : (
                <>
                  {iRolled && orr && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <DiceRow
                        dice={[]}
                        remaining={[]}
                        color={playerColor}
                        showLabels
                        myRoll={orr.myDie}
                      />
                    </div>
                  )}
                  <div className={styles.mutedText}>
                    {iRolled ? "Waiting for opponent..." : "Roll to start"}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {noMovesMessage && (
        <div className={styles.overlayDim}>
          <div className={styles.overlayCard}>
            <div style={{ marginBottom: "0.75rem" }}>
              <DiceRow dice={noMovesMessage.dice} remaining={[]} color={playerColor} />
            </div>
            <div className={styles.mutedText}>No moves available</div>
          </div>
        </div>
      )}
    </div>
  );
}
