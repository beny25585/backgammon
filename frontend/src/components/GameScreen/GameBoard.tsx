import { useState, useMemo, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import GuidanceBanner from "../GuidanceBanner";
import { DiceRow, RollPrompt } from "../Dice";
import {
  allLegalMoves,
  legalMovesFrom,
  getForcedMove,
  BAR,
  type Source,
  type Target,
  type Move,
} from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  onLeave?: (outcome?: "won" | "lost") => void;
  needsToRoll?: boolean;
  onRoll?: () => void;
  rollResult?: number[];
  onRollLand?: () => void;
  landing?: boolean;
  respondToDouble?: (accept: boolean) => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: import("../../lib/clock").TimeControl | null;
  autoRoll?: boolean;
  onAutoRollChange?: (value: boolean) => void;
  boardTheme?: BoardTheme;
  onBoardThemeChange?: (theme: BoardTheme) => void;
}

const themeClassByTheme: Record<BoardTheme, string> = {
  redGreen: styles.themeRedGreen,
  blueIvory: styles.themeBlueIvory,
  ivoryGold: styles.themeIvoryGold,
};

export default function GameBoard({
  state,
  playerColor,
  makeMove,
  undoMove,
  endTurn,
  onLeave,
  needsToRoll,
  onRoll,
  rollResult,
  onRollLand,
  landing,
  respondToDouble,
  clock,
  turnStartedAt,
  timeControl,
  autoRoll,
  onAutoRollChange,
  boardTheme,
  onBoardThemeChange,
}: GameBoardProps) {
  const [selected, setSelected] = useState<Source | null>(null);
  const [autoMove, setAutoMove] = useState<Move | null>(null);

  const isMyTurn = state.turn === playerColor && state.phase === "moving";
  const selectedBoardTheme = boardTheme ?? DEFAULT_BOARD_THEME;

  useEffect(() => {
    if (!isMyTurn) setSelected(null);
  }, [isMyTurn]);

  const legalFromPoints = useMemo(() => {
    if (!isMyTurn || !state || !state.points) return [];
    const moves = allLegalMoves(state, playerColor);
    const unique = new Set<Source>();
    for (const m of moves) unique.add(m.from);
    return Array.from(unique);
  }, [state, playerColor, isMyTurn]);

  const legalTargets = useMemo(() => {
    if (!isMyTurn || !state || !state.points || selected === null) return [];
    const moves = legalMovesFrom(state, selected, playerColor);
    const unique = new Set<Target>();
    for (const m of moves) unique.add(m.to);
    return Array.from(unique);
  }, [state, selected, playerColor, isMyTurn]);

  useEffect(() => {
    if (
      legalFromPoints.length === 1 &&
      legalFromPoints[0] === BAR &&
      selected !== BAR
    ) {
      setSelected(BAR);
    }
  }, [legalFromPoints, selected]);

  useEffect(() => {
    if (!isMyTurn || state.remaining.length === 0) {
      setAutoMove(null);
      return;
    }
    const forced = getForcedMove(state, playerColor);
    if (!forced) {
      setAutoMove(null);
      return;
    }
    const key = `${forced.from}->${forced.to}`;
    const t = setTimeout(() => {
      setAutoMove((prev) => {
        if (prev && `${prev.from}->${prev.to}` === key) return prev;
        return forced;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [state, playerColor, isMyTurn]);

  function handleSelect(from: Source | null) {
    setSelected(from);
  }

  function handleMove(to: Target) {
    const from = selected ?? (autoMove?.to === to ? autoMove.from : null);
    if (from === null) return;
    makeMove(from, to);
    setSelected(null);
  }

  return (
    <div
      className={`${styles.gameFrame} ${themeClassByTheme[selectedBoardTheme]}`}
      data-testid="board-frame"
    >
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
          autoMove={autoMove}
        />
        {!landing &&
          state.phase !== "opening_roll" &&
          state.phase === "moving" &&
          state.remaining.length > 0 && (
            <div className={styles.boardOverlay} data-testid="dice-overlay">
              <DiceRow
                dice={state.dice}
                remaining={state.remaining}
                color={state.turn}
              />
            </div>
          )}
        {needsToRoll && onRoll && !autoRoll && (
          <div className={styles.boardRollPrompt} data-testid="roll-prompt">
            <RollPrompt
              onRoll={onRoll}
              landOn={rollResult}
              onLand={onRollLand}
              dark={playerColor === "black"}
            />
          </div>
        )}
        <GuidanceBanner
          state={state}
          playerColor={playerColor}
          respondToDouble={respondToDouble ?? (() => {})}
        />
      </div>
      <SidePanel
        state={state}
        playerColor={playerColor}
        onLeave={onLeave}
        clock={clock}
        turnStartedAt={turnStartedAt}
        timeControl={timeControl}
        autoRoll={autoRoll}
        onAutoRollChange={onAutoRollChange}
        boardTheme={boardTheme}
        onBoardThemeChange={onBoardThemeChange}
      />
    </div>
  );
}
