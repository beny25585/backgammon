import { useState, useMemo, useEffect, useRef } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import { DiceRow } from "../Dice";
import {
  allLegalMoves,
  BAR,
  type Source,
  type Target,
  type Move,
} from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";
import type { NoMovesMessage } from "../../types/context";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target) => void;
  reorderDice?: () => void;
  undoMove?: () => void;
  endTurn?: () => void;
  offerDouble?: () => void;
  onLeave?: (outcome?: "won" | "lost") => void;
  needsToRoll?: boolean;
  onRoll?: () => void;
  respondToDouble?: (accept: boolean) => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: import("../../lib/clock").TimeControl | null;
  boardTheme?: BoardTheme;
  onBoardThemeChange?: (theme: BoardTheme) => void;
  noMovesMessage?: NoMovesMessage | null;
}

const themeClassByTheme: Record<BoardTheme, string> = {
  redGreen: styles.themeRedGreen,
  blueIvory: styles.themeBlueIvory,
  ivoryGold: styles.themeIvoryGold,
};

const FORCED_MOVE_DELAY_MS = 350;
// Visual lifetime only; automatic moves and turn transitions keep their own timers.
const TURN_NOTICE_DURATION_MS = 6000;

export default function GameBoard({
  state,
  playerColor,
  makeMove,
  reorderDice,
  undoMove,
  endTurn,
  offerDouble,
  onLeave,
  needsToRoll,
  onRoll,
  respondToDouble,
  clock,
  turnStartedAt,
  timeControl,
  boardTheme,
  onBoardThemeChange,
  noMovesMessage,
}: GameBoardProps) {
  const [selected, setSelected] = useState<Source | null>(null);
  const [autoMove, setAutoMove] = useState<Move | null>(null);
  const [visibleTurnNotice, setVisibleTurnNotice] =
    useState<GuidanceMessage | null>(null);
  const turnNoticeTimerRef = useRef<number | null>(null);

  const isMyTurn = state.turn === playerColor && state.phase === "moving";
  const selectedBoardTheme = boardTheme ?? DEFAULT_BOARD_THEME;

  useEffect(() => {
    if (!isMyTurn) setSelected(null);
  }, [isMyTurn]);

  const legalMoves = useMemo(() => {
    if (!isMyTurn || !state || !state.points) return [];
    return allLegalMoves(state, playerColor);
  }, [state, playerColor, isMyTurn]);

  const legalFromPoints = useMemo(() => {
    const unique = new Set<Source>();
    for (const move of legalMoves) unique.add(move.from);
    return Array.from(unique);
  }, [legalMoves]);

  const legalTargets = useMemo(() => {
    if (selected === null) return [];
    const unique = new Set<Target>();
    for (const move of legalMoves) {
      if (move.from === selected) unique.add(move.to);
    }
    return Array.from(unique);
  }, [legalMoves, selected]);

  const forcedMove = useMemo(() => {
    const placements = new Set(
      legalMoves.map((move) => `${move.from}->${move.to}`),
    );
    return placements.size === 1 ? legalMoves[0] : null;
  }, [legalMoves]);

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
    if (
      !isMyTurn ||
      state.remaining.length === 0
    ) {
      setAutoMove(null);
      return;
    }
    const forced = forcedMove;
    if (!forced) {
      setAutoMove(null);
      return;
    }
    setAutoMove(null);
    const t = setTimeout(() => {
      setAutoMove(forced);
    }, FORCED_MOVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.remaining.length, isMyTurn, forcedMove]);

  useEffect(() => {
    let notice: GuidanceMessage | null = null;
    if (noMovesMessage) {
      notice = {
        variant: "no-moves",
        text: "No moves available — turn passes",
      };
    } else if (isMyTurn && state.remaining.length > 0 && forcedMove) {
      notice = {
        variant: "forced",
        text: "Forced move — playing automatically",
      };
    }
    if (!notice) return;

    setVisibleTurnNotice(notice);
    if (turnNoticeTimerRef.current !== null) {
      window.clearTimeout(turnNoticeTimerRef.current);
    }
    turnNoticeTimerRef.current = window.setTimeout(() => {
      setVisibleTurnNotice(null);
      turnNoticeTimerRef.current = null;
    }, TURN_NOTICE_DURATION_MS);
  }, [noMovesMessage, isMyTurn, state.remaining.length, forcedMove]);

  useEffect(
    () => () => {
      if (turnNoticeTimerRef.current !== null) {
        window.clearTimeout(turnNoticeTimerRef.current);
      }
    },
    [],
  );

  const displayedDice = noMovesMessage?.dice ?? state.dice;
  const displayedRemaining = noMovesMessage?.remaining ?? state.remaining;
  const displayedDiceColor = noMovesMessage?.color ?? state.turn;
  const showDice = Boolean(noMovesMessage) ||
    (state.phase !== "opening_roll" &&
      state.phase === "moving" &&
      state.remaining.length > 0);

  function handleSelect(from: Source | null) {
    setSelected(from);
  }

  function handleMove(to: Target, explicitFrom?: Source) {
    const from =
      explicitFrom ?? selected ?? (autoMove?.to === to ? autoMove.from : null);
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
          onRoll={needsToRoll ? onRoll : undefined}
          onOfferDouble={offerDouble}
          autoMove={autoMove}
          turnNotice={visibleTurnNotice}
        />
        {showDice && (
            <div className={styles.boardOverlay} data-testid="dice-overlay">
              <DiceRow
                dice={displayedDice}
                remaining={displayedRemaining}
                color={displayedDiceColor}
                onReorder={isMyTurn ? reorderDice : undefined}
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
        boardTheme={boardTheme}
        onBoardThemeChange={onBoardThemeChange}
      />
    </div>
  );
}
