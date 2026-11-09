import { useState, useMemo, useEffect, useRef } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import GameSettingsPanel from "../SidePanel/GameSettingsPanel";
import GuidanceBanner from "../GuidanceBanner";
import BoardHalfOverlay from "../Board/BoardHalfOverlay";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import DiceOverlay from "./DiceOverlay";
import OpeningDice from "./OpeningDice";
import { useBlockedDiceFlight } from "./useBlockedDiceFlight";
import {
  allLegalMoves,
  BAR,
  getAutomaticMove,
  type Source,
  type Target,
  type Move,
} from "@/lib/backgammon/engine";
import type { GameState, Color, MatchContext } from "@/lib/backgammon/engine";
import type { NoMovesMessage, MakeMoveOptions } from "../../types/context";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import GameFrame from "./GameFrame";
import type { CheckerStyle } from "../Board/materials/checkerStyles";
import { useFollowingRoll } from "../../hooks/useFollowingRoll";
import { useForcedMoveNotice } from "../../hooks/useForcedMoveNotice";
import { usePlayerReactionControls } from "../../hooks/usePlayerReactionControls";
import PlayerReactionPicker from "../PlayerReactions/PlayerReactionPicker";
import BoardPlayerReactions from "../PlayerReactions/BoardPlayerReactions";
import { useGame } from "../../services/gameContext";

interface GameBoardProps {
  state: GameState;
  readOnly?: boolean;
  noticeScope?: string;
  match?: MatchContext;
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
  checkerStyle?: CheckerStyle;
  onCheckerStyleChange?: (style: CheckerStyle) => void;
  noMovesMessage?: NoMovesMessage | null;
  autoConfirmPending?: boolean;
  hasPendingMoves?: () => boolean;
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
  bracketUrl?: string;
  autoRoll?: boolean;
  autoRollCountdown?: number | null;
  onAutoRollChange?: (enabled: boolean) => void;
  recoveringOpening?: boolean;
}

function getGameplayKey(s: GameState): string {
  return `${s.points.join(",")}|${s.bar.white},${s.bar.black}|${s.home.white},${s.home.black}|${s.remaining.join(",")}|${s.turn}|${s.phase}|${JSON.stringify(s.lastMove)}`;
}

const FORCED_MOVE_DELAY_MS = 200;
// Visual lifetime only; automatic moves and turn transitions keep their own timers.
const TURN_NOTICE_DURATION_MS = 3000;

interface DicePlayback {
  scope: string;
  phase: GameState["phase"];
  turn: Color;
  recoveringOpening: boolean;
  roll: { kind: "live" | "following"; dice: string } | null;
}

export default function GameBoard({
  state,
  readOnly = false,
  noticeScope = "local",
  match,
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
  checkerStyle,
  onCheckerStyleChange,
  noMovesMessage,
  autoConfirmPending = false,
  hasPendingMoves,
  soundEnabled,
  onSoundEnabledChange,
  bracketUrl,
  autoRoll,
  autoRollCountdown,
  onAutoRollChange,
  recoveringOpening = false,
}: GameBoardProps) {
  const reactions = usePlayerReactionControls(playerColor);
  const { connectionEpoch, isLoading, adminReviewPending } = useGame();
  const gameplayBlocked = readOnly || adminReviewPending;
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

  const isMyTurn = !gameplayBlocked && state.turn === playerColor && state.phase === "moving";
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

  const forcedNotice = useForcedMoveNotice({
    state,
    playerColor,
    scope: `${noticeScope}:${match?.matchScore?.white ?? 0}:${match?.matchScore?.black ?? 0}`,
    eligible: !autoPointSequenceActive && forcedSequenceAllowed && isMyTurn &&
      state.remaining.length > 0 && forcedMove !== null,
    suppressed: Boolean(noMovesMessage),
  });

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
        id: noMovesMessage.id,
        expiresAt: noMovesMessage.expiresAt,
        variant: "no-moves",
        textKey: noMovesMessage.kind === "blocked_pass"
          ? ownRoll ? "guidance.barClosed" : "guidance.barClosedOpponent"
          : blockedOnBar
            ? ownRoll ? "guidance.barBlocked" : "guidance.barBlockedOpponent"
            : ownRoll ? "guidance.noMoves" : "guidance.noMovesOpponent",
      };
    }

    return forcedNotice;
  }, [
    noMovesMessage,
    state.bar,
    playerColor,
    forcedNotice,
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
  const gameAnimationScope = `${noticeScope}:${connectionEpoch ?? 0}:${match?.matchScore?.white ?? 0}:${match?.matchScore?.black ?? 0}`;
  const sharedDiceScope = `${gameAnimationScope}:${isLoading}`;
  const openingDiceScope = noticeScope === "local" ? sharedDiceScope : `${sharedDiceScope}:${playerColor}`;
  const diceScope = `${sharedDiceScope}:${playerColor}`;
  const diceValues = state.dice.join(",");
  const [dicePlayback, setDicePlayback] = useState<DicePlayback>(() => ({
    scope: diceScope, phase: state.phase, turn: state.turn, recoveringOpening, roll: null,
  }));
  if (dicePlayback.scope !== diceScope || dicePlayback.phase !== state.phase ||
    dicePlayback.turn !== state.turn || dicePlayback.recoveringOpening !== recoveringOpening) {
    // Resumes and snapshots are already on the table. Only a confirmed new roll travels.
    const rolledFromPrompt = dicePlayback.turn === state.turn && dicePlayback.phase === "rolling";
    const passedAndRolled = dicePlayback.turn !== state.turn && dicePlayback.phase === "moving" && !hasPlayedMoveThisTurn;
    const freshRoll = dicePlayback.scope === diceScope && !isLoading && !dicePlayback.recoveringOpening &&
      (rolledFromPrompt || passedAndRolled) &&
      state.phase === "moving" && state.dice.length === 2;
    setDicePlayback({
      scope: diceScope, phase: state.phase, turn: state.turn, recoveringOpening,
      roll: freshRoll ? { kind: noMovesMessage ? "following" : "live", dice: diceValues } : null,
    });
  }
  const boardThrow = dicePlayback.roll;
  const originalDiceCount = state.dice[0] === state.dice[1] ? 4 : state.dice.length;
  const interruptThrow = Boolean(boardThrow && (
    gameplayBlocked || autoPointSequenceActive || autoConfirmPending ||
    boardThrow.dice !== diceValues || state.remaining.length !== originalDiceCount
  ));
  if (interruptThrow) {
    // A replaced dice button must not replay a roll that already started.
    setDicePlayback(previous => ({ ...previous, roll: null }));
  }
  const turnComplete = isMyTurn && state.remaining.length === 0;
  const completedRoll = state.phase === "moving" && state.dice.length > 0 && state.remaining.length === 0 &&
    hasPlayedMoveThisTurn && !noMovesMessage;
  const liveRoll = !turnComplete && state.phase === "moving" && (state.remaining.length > 0 || completedRoll) &&
    (!noMovesMessage || state.turn === noMovesMessage.color);
  const onReorder = isMyTurn && !autoPointSequenceActive && !autoConfirmPending ? reorderDice : undefined;
  const liveDice = liveRoll ? (
    <DiceOverlay dice={state.dice} remaining={state.remaining} color={state.turn}
      playerColor={playerColor} usedOpacity={completedRoll ? 0.65 : undefined}
      throwOnBoard={boardThrow?.kind === "live"} settled={boardThrow?.kind !== "live"} interruptThrow={interruptThrow}
      onReorder={state.turn === playerColor && !completedRoll ? onReorder : undefined} />
  ) : null;
  const ownFollowingRollActive = followingRoll?.color === playerColor && isMyTurn && state.remaining.length > 0;
  const followingFlight = boardThrow?.kind === "following" && followingRoll?.color === state.turn;
  const followingDice = followingRoll && !(turnComplete && followingRoll.color === playerColor) ? (
    <DiceOverlay kind="following" dice={followingRoll.dice} color={followingRoll.color} playerColor={playerColor}
      remaining={ownFollowingRollActive ? state.remaining : followingRoll.dice}
      forceActive={!ownFollowingRollActive}
      throwOnBoard={followingFlight} settled={!followingFlight}
      interruptThrow={interruptThrow}
      onReorder={ownFollowingRollActive ? onReorder : undefined} />
  ) : null;
  // Roll snapshots keep their roller's side across turn changes. Completing our
  // own turn replaces any own snapshot with confirmation in the same position.
  const blockedSide = noMovesMessage?.color === playerColor ? "right" : "left";
  const followingSide = blockedSide === "right" ? "left" : "right";
  const blockedFlight = useBlockedDiceFlight(openingDiceScope, state, noMovesMessage) && !readOnly;
  const blockedLanding = blockedFlight && visibleTurnNotice?.variant === "no-moves";
  const rollDetails = noMovesMessage ? {
    [blockedSide]: turnComplete && noMovesMessage.color === playerColor ? null : (
      <>
        {noMovesMessage.dice.length > 0 && (
          <DiceOverlay kind="blocked" dice={noMovesMessage.dice} remaining={noMovesMessage.remaining}
            color={noMovesMessage.color} playerColor={playerColor} forceActive
            throwOnBoard={blockedLanding} settled={!blockedLanding}
            awaitingThrow={blockedFlight && noMovesMessage.noticeVisible === false} />
        )}
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
    <GameFrame theme={selectedBoardTheme} checkerStyle={checkerStyle} settingsDisabled={readOnly} settings={
      <GameSettingsPanel state={state} onLeave={onLeave} boardTheme={boardTheme}
        onBoardThemeChange={onBoardThemeChange} soundEnabled={soundEnabled}
        checkerStyle={checkerStyle} onCheckerStyleChange={onCheckerStyleChange}
        onSoundEnabledChange={onSoundEnabledChange} bracketUrl={bracketUrl}
        autoRoll={autoRoll} onAutoRollChange={onAutoRollChange} />
    }>
      {(settingsToggle) => <>
      <SidePanel key={`${noticeScope}:${playerColor}`} state={state} playerColor={playerColor} clock={clock}
        turnStartedAt={turnStartedAt} timeControl={timeControl} settingsToggle={settingsToggle}
        reactionPicker={reactions.pickerProps ? readOnly ? (
          <div aria-hidden="true" className="min-h-11" />
        ) : <PlayerReactionPicker key={reactions.scope} {...reactions.pickerProps} /> : null} />
      <div className={`${styles.boardArea} col-start-2 row-start-2`}>
        <Board
          state={state}
          match={match}
          myColor={playerColor}
          selected={selectedSource}
          legalTargets={legalTargets}
          onSelect={handleSelect}
          onMove={handleMove}
          legalFromPoints={legalFromPoints}
          onUndo={autoConfirmPending || adminReviewPending ? undefined : undoMove}
          onConfirm={autoConfirmPending || adminReviewPending ? undefined : endTurn}
          onRoll={needsToRoll ? onRoll : undefined}
          autoRollCountdown={autoRollCountdown}
          onOfferDouble={adminReviewPending ? undefined : offerDouble}
          autoMove={activeAutoMove}
          turnNotice={visibleTurnNotice}
          noticeSide={noMovesMessage ? blockedSide : "right"}
          rollDetails={rollDetails}
          onAutoPointSequenceChange={setAutoPointSequenceActive}
          inputDisabled={autoConfirmPending || gameplayBlocked}
          captureScope={gameAnimationScope}
          hasPendingMoves={hasPendingMoves}
          overlay={
            <>
              {!readOnly && <BoardPlayerReactions reactions={reactions.reactions} names={reactions.names} playerColor={playerColor} />}
              <OpeningDice state={state} playerColor={playerColor} scope={openingDiceScope} readOnly={readOnly} />
              {!noMovesMessage && liveDice && (
                <BoardHalfOverlay side={state.turn === playerColor ? "right" : "left"}>
                  {liveDice}
                </BoardHalfOverlay>
              )}
              {!adminReviewPending && <GuidanceBanner state={state} playerColor={playerColor}
                respondToDouble={respondToDouble ?? (() => {})} boardAligned />}
            </>
          }
        />
      </div>
      </>}
    </GameFrame>
  );
}
