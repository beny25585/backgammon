import { useState, useMemo, useEffect, useRef } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import GameSettingsPanel from "../SidePanel/GameSettingsPanel";
import GuidanceBanner from "../GuidanceBanner";
import BoardHalfOverlay from "../Board/BoardHalfOverlay";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import DiceOverlay from "./DiceOverlay";
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
import GameFrame from "./GameFrame";
import { useFollowingRoll } from "../../hooks/useFollowingRoll";

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
  hasPendingMoves?: () => boolean;
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
  bracketUrl?: string;
  autoRoll?: boolean;
  onAutoRollChange?: (enabled: boolean) => void;
}

function getGameplayKey(s: GameState): string {
  return `${s.points.join(",")}|${s.bar.white},${s.bar.black}|${s.home.white},${s.home.black}|${s.remaining.join(",")}|${s.turn}|${s.phase}|${JSON.stringify(s.lastMove)}`;
}

const FORCED_MOVE_DELAY_MS = 200;
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
  hasPendingMoves,
  soundEnabled,
  onSoundEnabledChange,
  bracketUrl,
  autoRoll,
  onAutoRollChange,
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

  const [forcedSequenceActive, setForcedSequenceActive] = useState(false);

  const [forcedAwaitingAck, setForcedAwaitingAck] = useState<{
    version: number;
    fromPositionKey: string;
    from: Source;
    to: Target;
  } | null>(null);
  const [autoPointSequenceActive, setAutoPointSequenceActive] = useState(false);
  const [hiddenTurnNotice, setHiddenTurnNotice] =
    useState<GuidanceMessage | null>(null);

  const isMyTurn = state.turn === playerColor && state.phase === "moving";
  const selectedBoardTheme = boardTheme ?? DEFAULT_BOARD_THEME;
  const stateVersion = state.version ?? 0;
  const hasPlayedMoveThisTurn =
    Array.isArray(state.lastMove) && state.lastMove.length > 0;

  const forcedSequenceAllowed = !hasPlayedMoveThisTurn || forcedSequenceActive;

  const waitingForForcedAck = forcedAwaitingAck !== null;

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

  useEffect(() => {
    const pending = forcedAwaitingAck;
    if (!pending) return;

    const acknowledged =
      typeof state.version === "number"
        ? stateVersion > pending.version
        : getGameplayKey(state) !== pending.fromPositionKey;

    if (!acknowledged) return;

    const lastMove =
      Array.isArray(state.lastMove) && state.lastMove.length > 0
        ? state.lastMove[state.lastMove.length - 1]
        : null;

    if (
      !lastMove ||
      lastMove.from !== pending.from ||
      lastMove.to !== pending.to
    ) {
      setForcedSequenceActive(false);
      setForcedAwaitingAck(null);
      forcedCommandIdRef.current += 1;
      setAutoMove(null);
      return;
    }

    setForcedAwaitingAck(null);
    setAutoMove(null);
  }, [state, stateVersion, forcedAwaitingAck]);

  useEffect(() => {
    if (!forcedSequenceActive) return;
    if (forcedAwaitingAck) return;
    if (!isMyTurn) return;

    if (state.remaining.length === 0 || !forcedMove) {
      setForcedSequenceActive(false);
      forcedCommandIdRef.current += 1;
      setAutoMove(null);
    }
  }, [state, isMyTurn, forcedMove, forcedSequenceActive, forcedAwaitingAck]);

  useEffect(() => {
    if (isMyTurn) return;

    setForcedSequenceActive(false);
    setForcedAwaitingAck(null);
    forcedCommandIdRef.current += 1;
    setAutoMove(null);
  }, [isMyTurn]);

  const turnNotice = useMemo<GuidanceMessage | null>(() => {
    if (
      noMovesMessage &&
      noMovesMessage.noticeVisible !== false
    ) {
      const ownRoll = noMovesMessage.color === playerColor;
      const blockedOnBar = state.bar[noMovesMessage.color] > 0;
      return {
        variant: "no-moves",
        textKey: blockedOnBar
          ? ownRoll ? "guidance.barBlocked" : "guidance.barBlockedOpponent"
          : ownRoll ? "guidance.noMoves" : "guidance.noMovesOpponent",
      };
    }

    if (
      !autoPointSequenceActive &&
      forcedSequenceAllowed &&
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
    state.bar,
    playerColor,
    autoPointSequenceActive,
    forcedSequenceAllowed,
    isMyTurn,
    state.remaining.length,
    forcedMove,
  ]);

  const visibleTurnNotice = turnNotice === hiddenTurnNotice ? null : turnNotice;

  useEffect(() => {
    const id = ++forcedCommandIdRef.current;

    if (
      autoPointSequenceActive ||
      !forcedSequenceAllowed ||
      waitingForForcedAck ||
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
  }, [
    state,
    isMyTurn,
    forcedMove,
    autoPointSequenceActive,
    forcedSequenceAllowed,
    waitingForForcedAck,
  ]);

  const activeAutoMove =
    autoPointSequenceActive ||
    !forcedSequenceAllowed ||
    waitingForForcedAck ||
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

  const followingRoll = useFollowingRoll(state, noMovesMessage);
  const turnComplete = isMyTurn && state.remaining.length === 0;
  const completedRoll = state.phase === "moving" && state.dice.length > 0 && state.remaining.length === 0 &&
    hasPlayedMoveThisTurn && !noMovesMessage;
  const liveRoll = !turnComplete && state.phase === "moving" && (state.remaining.length > 0 || completedRoll) &&
    (!noMovesMessage || state.turn === noMovesMessage.color);
  const onReorder = isMyTurn && !autoPointSequenceActive && !autoConfirmPending ? reorderDice : undefined;
  const liveDice = liveRoll ? (
    <DiceOverlay dice={state.dice} remaining={state.remaining} color={state.turn}
      playerColor={playerColor} usedOpacity={completedRoll ? 0.65 : undefined}
      onReorder={state.turn === playerColor && !completedRoll ? onReorder : undefined} />
  ) : null;
  const ownFollowingRollActive = followingRoll?.color === playerColor && isMyTurn && state.remaining.length > 0;
  const followingDice = followingRoll && !(turnComplete && followingRoll.color === playerColor) ? (
    <DiceOverlay kind="following" dice={followingRoll.dice} color={followingRoll.color} playerColor={playerColor}
      remaining={ownFollowingRollActive ? state.remaining : followingRoll.dice}
      forceActive={!ownFollowingRollActive}
      onReorder={ownFollowingRollActive ? onReorder : undefined} />
  ) : null;
  // Roll snapshots keep their roller's side across turn changes. Completing our
  // own turn replaces any own snapshot with confirmation in the same position.
  const blockedSide = noMovesMessage?.color === playerColor ? "right" : "left";
  const followingSide = blockedSide === "right" ? "left" : "right";
  const rollDetails = noMovesMessage ? {
    [blockedSide]: turnComplete && noMovesMessage.color === playerColor ? null : (
      <>
        <DiceOverlay kind="blocked" dice={noMovesMessage.dice} remaining={noMovesMessage.remaining}
          color={noMovesMessage.color} playerColor={playerColor} forceActive />
        {liveDice}
      </>
    ),
    [followingSide]: followingDice,
  } : undefined;

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
    if (options?.origin === "forced") {
      setForcedSequenceActive(true);
      setForcedAwaitingAck({
        version: stateVersion,
        fromPositionKey: getGameplayKey(state),
        from,
        to,
      });
    } else {
      setForcedSequenceActive(false);
      setForcedAwaitingAck(null);
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
    <GameFrame theme={selectedBoardTheme} settings={
      <GameSettingsPanel state={state} onLeave={onLeave} boardTheme={boardTheme}
        onBoardThemeChange={onBoardThemeChange} soundEnabled={soundEnabled}
        onSoundEnabledChange={onSoundEnabledChange} bracketUrl={bracketUrl}
        autoRoll={autoRoll} onAutoRollChange={onAutoRollChange} />
    }>
      {(settingsToggle) => <>
      <SidePanel state={state} playerColor={playerColor} clock={clock}
        turnStartedAt={turnStartedAt} timeControl={timeControl} settingsToggle={settingsToggle} />
      <div className={`${styles.boardArea} col-start-2 row-start-2`}>
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
          noticeSide={noMovesMessage ? blockedSide : "left"}
          rollDetails={rollDetails}
          onAutoPointSequenceChange={setAutoPointSequenceActive}
          inputDisabled={autoConfirmPending}
          hasPendingMoves={hasPendingMoves}
          overlay={
            <>
              {!noMovesMessage && liveDice && (
                <BoardHalfOverlay side={state.turn === playerColor ? "right" : "left"}>
                  {liveDice}
                </BoardHalfOverlay>
              )}
              <GuidanceBanner state={state} playerColor={playerColor}
                respondToDouble={respondToDouble ?? (() => {})} boardAligned />
            </>
          }
        />
      </div>
      </>}
    </GameFrame>
  );
}
