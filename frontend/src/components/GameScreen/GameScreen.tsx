import { useState, useMemo, useCallback, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import { Board } from "../Board";
import OpponentBar from "../OpponentBar";
import Controls from "../Controls";
import TurnIndicator from "../TurnIndicator";
import { DiceRow, RollPrompt } from "../Dice";
import { allLegalMoves, legalMovesFrom, BAR, OFF, type Source, type Target } from "@/lib/backgammon/engine";
import { motion } from "motion/react";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const { state, playerColor, isLoading, error, makeMove, rollDice, openingRollResult, setOpeningRollResult, reconnected, opponentConnected } = useGame();
  const [selected, setSelected] = useState<Source | null>(null);

  const legalFromPoints = useMemo(() => {
    if (!state) return [];
    const moves = allLegalMoves(state, playerColor);
    const unique = new Set<Source>();
    for (const m of moves) unique.add(m.from);
    return Array.from(unique);
  }, [state, playerColor]);

  const legalTargets = useMemo(() => {
    if (!state || selected === null) return [];
    const moves = legalMovesFrom(state, selected, playerColor);
    const unique = new Set<Target>();
    for (const m of moves) unique.add(m.to);
    return Array.from(unique);
  }, [state, selected, playerColor]);

  const opponentColor = useMemo(
    () => (playerColor === "white" ? "black" : "white"),
    [playerColor],
  );

  function handleSelect(from: Source | null) {
    setSelected(from);
  }

  function handleMove(to: Target) {
    if (selected === null) return;
    makeMove(selected, to);
    setSelected(null);
  }

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  const isOpeningRoll = state?.phase === "opening_roll";
  const isMyTurnToRoll = isOpeningRoll && state?.turn === playerColor;
  const iRolled = isOpeningRoll && openingRollResult?.myDie != null;
  const bothRolled = openingRollResult?.myDie != null && openingRollResult?.opponentDie != null;
  const needsToRoll = state?.phase === "rolling" && state?.dice.length === 0 && state?.turn === playerColor;

  // Clear opening roll state when phase moves past opening_roll
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
      <div className={styles.gameFrame}>
        {reconnected && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
            Reconnected
          </div>
        )}
        {!opponentConnected && !reconnected && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-yellow-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
            Opponent disconnected
          </div>
        )}
        <OpponentBar color={opponentColor} state={state} />

        <div className={`${styles.mainContent} relative`}>
          <Board
            state={state}
            myColor={playerColor}
            selected={selected}
            legalTargets={legalTargets}
            onSelect={handleSelect}
            onMove={handleMove}
            legalFromPoints={legalFromPoints}
          />

          {/* Opening roll overlay — full screen center */}
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

          {/* Normal roll prompt — full screen center */}
          {needsToRoll && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
              <div className="bg-black/85 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-gold/30">
                <RollPrompt onRoll={handleRoll} />
              </div>
            </div>
          )}

          {/* Normal dice display — full screen center */}
          {!isOpeningRoll && state.dice.length > 0 && (
            <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
              <div className="bg-black/80 backdrop-blur-md rounded-3xl p-6 shadow-2xl border border-gold/30">
                <DiceRow dice={state.dice} remaining={state.remaining} color={playerColor} />
              </div>
            </div>
          )}
        </div>

        <div className={styles.controlsSection}>
          <div className={styles.leftPanel}>
            <TurnIndicator
              currentTurn={state.turn}
              playerColor={playerColor}
            />
          </div>

          <Controls playerColor={playerColor} state={state} />

          {onLeave && (
            <button onClick={onLeave} className={styles.leaveButton}>
              Leave
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
