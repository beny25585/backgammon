import { useState, useMemo } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import OpponentBar from "../OpponentBar";
import Controls from "../Controls";
import TurnIndicator from "../TurnIndicator";
import { DiceRow } from "../Dice";
import { allLegalMoves, legalMovesFrom, BAR, OFF, type Source, type Target } from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  onLeave?: () => void;
}

export default function GameBoard({
  state,
  playerColor,
  makeMove,
  undoMove,
  endTurn,
  onLeave,
}: GameBoardProps) {
  const [selected, setSelected] = useState<Source | null>(null);

  const legalFromPoints = useMemo(() => {
    if (!state || !state.points) return [];
    const moves = allLegalMoves(state, playerColor);
    const unique = new Set<Source>();
    for (const m of moves) unique.add(m.from);
    return Array.from(unique);
  }, [state, playerColor]);

  const legalTargets = useMemo(() => {
    if (!state || !state.points || selected === null) return [];
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

  return (
    <div className={styles.gameFrame}>
      <div className={styles.boardArea}>
        <Board
          state={state}
          myColor={playerColor}
          selected={selected}
          legalTargets={legalTargets}
          onSelect={handleSelect}
          onMove={handleMove}
          legalFromPoints={legalFromPoints}
          onUndo={undoMove}
          onConfirm={endTurn}
        />
        {state.phase !== "opening_roll" && state.phase === "moving" && state.turn === playerColor && state.remaining.length > 0 && (
          <div className={styles.boardOverlay}>
            <DiceRow dice={state.dice} remaining={state.remaining} color={playerColor} />
          </div>
        )}
      </div>
      <div className={styles.sidePanel}>
        <OpponentBar color={opponentColor} state={state} />
        <TurnIndicator currentTurn={state.turn} playerColor={playerColor} />
        <Controls playerColor={playerColor} state={state} />
        {onLeave && (
          <button onClick={onLeave} className={styles.leaveButton}>
            Leave
          </button>
        )}
      </div>
    </div>
  );
}
