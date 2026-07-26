import { useState, useCallback, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import { DiceRow, RollPrompt } from "../Dice";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const { state, playerColor, isLoading, error, makeMove, rollDice, openingRollResult, setOpeningRollResult, reconnected, opponentConnected, undoMove, endTurn } = useGame();

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  const isOpeningRoll = state?.phase === "opening_roll";
  const isMyTurnToRoll = isOpeningRoll && state?.openingRoll?.[playerColor] == null;
  const iRolled = isOpeningRoll && openingRollResult?.myDie != null;
  const bothRolled = openingRollResult?.myDie != null && openingRollResult?.opponentDie != null;
  const needsToRoll = state?.phase === "rolling" && state?.dice.length === 0 && state?.turn === playerColor;

  if (state && state.phase !== "opening_roll" && openingRollResult !== null) {
    setOpeningRollResult(null);
  }

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
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
          Reconnected
        </div>
      )}
      {!opponentConnected && !reconnected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-black/85 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-gold/30 text-center">
            <div className="text-yellow-400 text-lg font-bold mb-2">Opponent Disconnected</div>
            <div className="text-white/60 text-sm">Waiting for opponent to reconnect...</div>
          </div>
        </div>
      )}

      <GameBoard
        state={state}
        playerColor={playerColor}
        makeMove={makeMove}
        undoMove={undoMove}
        endTurn={endTurn}
        onLeave={onLeave}
      />

      {isOpeningRoll && (() => {
        const orr = openingRollResult;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-black/85 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-gold/30 min-w-64 text-center">
              {isMyTurnToRoll && !iRolled ? (
                <RollPrompt onRoll={handleRoll} isOpening />
              ) : bothRolled && orr ? (
                <>
                  <div className="mb-3">
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
                    <div className="text-gold text-sm font-bold">You go first!</div>
                  )}
                  {orr.winner && orr.winner !== playerColor && (
                    <div className="text-white/70 text-sm">Opponent goes first</div>
                  )}
                </>
              ) : (
                <>
                  {iRolled && orr && (
                    <div className="mb-3">
                      <DiceRow
                        dice={[]}
                        remaining={[]}
                        color={playerColor}
                        showLabels
                        myRoll={orr.myDie}
                      />
                    </div>
                  )}
                  <div className="text-white/40 text-sm">
                    {iRolled ? "Waiting for opponent..." : "Roll to start"}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {needsToRoll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="bg-black/85 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-gold/30">
            <RollPrompt onRoll={handleRoll} />
          </div>
        </div>
      )}
    </div>
  );
}
