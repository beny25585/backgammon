import { useState, useMemo } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import { DiceRow, RollPrompt } from "../Dice";
import { allLegalMoves, legalMovesFrom, type Source, type Target } from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  onLeave?: () => void;
  needsToRoll?: boolean;
  onRoll?: () => void;
}

export default function GameBoard({
  state,
  playerColor,
  makeMove,
  undoMove,
  endTurn,
  onLeave,
  needsToRoll,
  onRoll,
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
        {state.phase !== "opening_roll" && state.phase === "moving" && state.remaining.length > 0 && (
          <div className={styles.boardOverlay} data-testid="dice-overlay">
            <DiceRow dice={state.dice} remaining={state.remaining} color={state.turn} />
          </div>
        )}
        {needsToRoll && onRoll && (
          <div className={styles.boardRollPrompt} data-testid="roll-prompt">
            <RollPrompt onRoll={onRoll} dark={playerColor === "black"} />
          </div>
        )}
      </div>
      <SidePanel
        state={state}
        playerColor={playerColor}
        onLeave={onLeave}
      />
    </div>
  );
}
