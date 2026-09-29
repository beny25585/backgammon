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
  getAutomaticMove,
  type Source,
  type Target,
  type Move,
} from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";
import type { NoMovesMessage, MakeMoveOptions } from "../../types/context";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target, options?: MakeMoveOptions) => void;
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
  autoConfirmPending?: boolean;
}

const themeClassByTheme: Record<BoardTheme, string> = {
  redGreen: styles.themeRedGreen,
  blueIvory: styles.themeBlueIvory,
  ivoryGold: styles.themeIvoryGold,
};

function getGameplayKey(s: GameState): string {
  return `${s.points.join(",")}|${s.bar.white},${s.bar.black}|${s.home.white},${s.home.black}|${s.remaining.join(",")}|${s.turn}|${s.phase}|${JSON.stringify(s.lastMove)}`;
}

const FORCED_MOVE_DELAY_MS = 350;
// Visual lifetime only; automatic moves and turn transitions keep their own timers.
const TURN_NOTICE_DURATION_MS = 3000;

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
  autoConfirmPending = false,
}: GameBoardProps) {
  const [selection, setSelection] = useState<{
    from: Source | null;
    version: number;
  }>({
    from: null,
    version: state.version ?? 0,
  });
  const [autoMove, setAutoMove] = useState<{
    id: number;
    fromPositionKey: string;
    move: Move;
  } | null>(null);
  const forcedCommandIdRef = useRef(0);
  const [autoPointSequenceActive, setAutoPointSequenceActive] = useState(false);
  const [hiddenTurnNotice, setHiddenTurnNotice] =
    useState<GuidanceMessage | null>(null);

  const isMyTurn = state.turn === playerColor && state.phase === "moving";
  const selectedBoardTheme = boardTheme ?? DEFAULT_BOARD_THEME;
  const stateVersion = state.version ?? 0;

  const legalMoves = useMemo(() => {
    if (!isMyTurn || !state || !state.points) return [];
    return allLegalMoves(state, playerColor);
  }, [state, playerColor, isMyTurn]);

  const legalFromPoints = useMemo(() => {
    const unique = new Set<Source>();
    for (const move of legalMoves) unique.add(move.from);
    return Array.from(unique);
  }, [legalMoves]);

  const selectedSource =
    legalFromPoints.length === 1 && legalFromPoints[0] === BAR
      ? BAR
      : selection.version === stateVersion
        ? selection.from
        : null;

  const legalTargets = useMemo(() => {
    if (selectedSource === null) return [];
    const unique = new Set<Target>();
    for (const move of legalMoves) {
      if (move.from === selectedSource) unique.add(move.to);
    }
    return Array.from(unique);
  }, [legalMoves, selectedSource]);

  const forcedMove = useMemo(() => {
    if (!isMyTurn || state.remaining.length === 0) {
      return null;
    }

    return getAutomaticMove(state, playerColor);
  }, [state, playerColor, isMyTurn]);

  const turnNotice = useMemo<GuidanceMessage | null>(() => {
    if (
      noMovesMessage?.color === playerColor &&
      noMovesMessage.noticeVisible !== false
    ) {
      return {
        variant: "no-moves",
        textKey: "guidance.noMoves",
      };
    }

    if (
      !autoPointSequenceActive &&
      isMyTurn &&
      state.remaining.length > 0 &&
      forcedMove
    ) {
      return {
        variant: "forced",
        textKey: "guidance.forced",
      };
    }

    return null;
  }, [
    noMovesMessage,
    playerColor,
    autoPointSequenceActive,
    isMyTurn,
    state.remaining.length,
    forcedMove,
  ]);

  const visibleTurnNotice = turnNotice === hiddenTurnNotice ? null : turnNotice;

  useEffect(() => {
    const id = ++forcedCommandIdRef.current;

    if (
      autoPointSequenceActive ||
      !isMyTurn ||
      state.remaining.length === 0 ||
      !forcedMove
    ) {
      return;
    }

    const command = {
      id,
      fromPositionKey: getGameplayKey(state),
      move: forcedMove,
    };

    const timer = window.setTimeout(() => {
      if (forcedCommandIdRef.current !== id) return;
      setAutoMove(command);
    }, FORCED_MOVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state, isMyTurn, forcedMove, autoPointSequenceActive]);

  const activeAutoMove =
    autoPointSequenceActive ||
    !isMyTurn ||
    state.remaining.length === 0 ||
    !forcedMove ||
    autoMove?.fromPositionKey !== getGameplayKey(state)
      ? null
      : autoMove;

  useEffect(() => {
    if (!turnNotice) return;

    const timer = window.setTimeout(() => {
      setHiddenTurnNotice(turnNotice);
    }, TURN_NOTICE_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [turnNotice]);

  const displayedDice = noMovesMessage?.dice ?? state.dice;
  const displayedRemaining = noMovesMessage?.remaining ?? state.remaining;
  const displayedDiceColor = noMovesMessage?.color ?? state.turn;
  const showDice =
    Boolean(noMovesMessage) ||
    (state.phase !== "opening_roll" &&
      state.phase === "moving" &&
      state.remaining.length > 0);

  function handleSelect(from: Source | null) {
    setSelection({
      from,
      version: stateVersion,
    });
  }

  function handleMove(
    to: Target,
    explicitFrom?: Source,
    options?: MakeMoveOptions,
  ) {
    const from =
      explicitFrom ??
      selectedSource ??
      (activeAutoMove?.move.to === to ? activeAutoMove.move.from : null);
    if (from === null) return;
    if (options?.origin !== "forced") {
      forcedCommandIdRef.current += 1;
      setAutoMove(null);
    }
    makeMove(from, to, options);
    setSelection({
      from: null,
      version: stateVersion,
    });
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
          selected={selectedSource}
          legalTargets={legalTargets}
          onSelect={handleSelect}
          onMove={handleMove}
          legalFromPoints={legalFromPoints}
          onUndo={autoConfirmPending ? undefined : undoMove}
          onConfirm={autoConfirmPending ? undefined : endTurn}
          onRoll={needsToRoll ? onRoll : undefined}
          onOfferDouble={offerDouble}
          autoMove={activeAutoMove}
          turnNotice={visibleTurnNotice}
          onAutoPointSequenceChange={setAutoPointSequenceActive}
          inputDisabled={autoConfirmPending}
        />
        {showDice && (
          <div className={styles.boardOverlay} data-testid="dice-overlay">
            <DiceRow
              dice={displayedDice}
              remaining={displayedRemaining}
              color={displayedDiceColor}
              onReorder={
                isMyTurn && !autoPointSequenceActive && !autoConfirmPending
                  ? reorderDice
                  : undefined
              }
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
