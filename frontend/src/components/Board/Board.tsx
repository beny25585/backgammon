import {
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import {
  BAR,
  OFF,
  canOfferDouble,
  legalMovesFrom,
  allLegalMoves,
  applyMove,
  getAutomaticMove,
  getMakePointSequence,
  type Move,
} from "@/lib/backgammon/engine";
import type { MakeMoveOptions } from "../../types/context";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import PointCell from "./pieces/pointcell/PointCell";
import Bar from "./pieces/bar/Bar";
import BearOff from "./pieces/bearoff/BearOff";
import FlyingChecker from "../animations/FlyingChecker/FlyingChecker";
import DoublingCube from "../DoublingCube";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import styles from "../GameScreen/GameScreen.module.css";
import { TOP_POINTS, BOTTOM_POINTS } from "./layout";
import { useI18n } from "../../i18n/I18nProvider";
import Checker from "./pieces/checker/Checker";
import { useCheckerDrag } from "./useCheckerDrag";
import dragStyles from "./CheckerDrag.module.css";

interface BoardProps {
  state: GameState;
  myColor: Color | null;
  selected: Source | null;
  legalTargets: Target[];
  onSelect: (from: Source | null) => void;
  onMove: (to: Target, from?: Source, options?: MakeMoveOptions) => void;
  legalFromPoints: Source[];
  onUndo?: () => void;
  onConfirm?: () => void;
  onRoll?: () => void;
  onOfferDouble?: () => void;
  autoMove?: { id: number; fromPositionKey: string; move: Move } | null;
  inputDisabled?: boolean;
  turnNotice?: GuidanceMessage | null;
  onAutoPointSequenceChange?: (active: boolean) => void;
}

function getCheckerSize(board: HTMLElement): number {
  const checkerEl = board.querySelector<HTMLElement>("[data-checker]");
  if (!checkerEl) return 30;
  return checkerEl.getBoundingClientRect().width;
}

function checkerCountAt(
  state: GameState,
  location: Source | Target,
  color: Color,
): number {
  if (typeof location === "number") {
    return Math.abs(state.points[location] ?? 0);
  }
  return location === BAR ? state.bar[color] : state.home[color];
}

function preferredDirectMove(moves: Move[], remaining: number[]): Move | null {
  if (moves.length === 0) return null;
  for (const die of remaining) {
    const move = moves.find((m) => m.die === die);
    if (move) return move;
  }
  return [...moves].sort((a, b) => b.die - a.die)[0];
}

function pointNumberFor(index: number, color: Color | null): number {
  return color === "black" ? 24 - index : index + 1;
}

function diceUnorderedEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function lastMoveEqual(
  a: { from: Source | Target; to: Target }[] | null,
  b: { from: Source | Target; to: Target }[] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].from !== b[i].from || a[i].to !== b[i].to) return false;
  }
  return true;
}

function gameplayEqual(a: GameState, b: GameState): boolean {
  if (a.turn !== b.turn) return false;
  if (a.phase !== b.phase) return false;
  if (a.bar.white !== b.bar.white || a.bar.black !== b.bar.black) return false;
  if (a.home.white !== b.home.white || a.home.black !== b.home.black) return false;
  if (!diceUnorderedEqual(a.dice, b.dice)) return false;
  if (!diceUnorderedEqual(a.remaining, b.remaining)) return false;
  if (!lastMoveEqual(a.lastMove, b.lastMove)) return false;
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) if (a.points[i] !== b.points[i]) return false;
  return true;
}

function getGameplayKey(s: GameState): string {
  return `${s.points.join(",")}|${s.bar.white},${s.bar.black}|${s.home.white},${s.home.black}|${s.remaining.join(",")}|${s.turn}|${s.phase}|${JSON.stringify(s.lastMove)}`;
}

export function Board({
  state,
  myColor,
  selected,
  legalTargets,
  onSelect,
  onMove,
  legalFromPoints,
  onUndo,
  onConfirm,
  onRoll,
  onOfferDouble,
  autoMove,
  inputDisabled = false,
  turnNotice,
  onAutoPointSequenceChange,
}: BoardProps) {
  const { t } = useI18n();
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onAutoPointSequenceChangeRef = useRef(onAutoPointSequenceChange);
  useLayoutEffect(() => {
    onAutoPointSequenceChangeRef.current = onAutoPointSequenceChange;
  }, [onAutoPointSequenceChange]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const point = board?.querySelector<HTMLElement>("[data-point-idx]");
    if (!board || !point) return;

    const fitCheckers = () => {
      const stack = point.lastElementChild;
      if (!(stack instanceof HTMLElement)) return;
      const style = getComputedStyle(stack);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gaps = 4 * (parseFloat(style.rowGap) || 0);
      // All points have the same height. Reserve space for five full circles,
      // stack padding and four gaps, even on a short landscape viewport.
      const size = Math.max(0, (point.clientHeight - padding - gaps) / 5);
      board.style.setProperty("--checker-height-limit", `${size}px`);
    };
    fitCheckers();
    const observer = new ResizeObserver(fitCheckers);
    observer.observe(point);
    return () => observer.disconnect();
  }, []);
  const flightIdRef = useRef(0);
  const [flyChecker, setFlyChecker] = useState<{
    id: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    from: Source | Target;
    fromCount: number;
    color: Color;
    size: number;
    to: Source | Target;
    undo?: boolean;
    external?: boolean;
    committed: boolean;
  } | null>(null);

  const knownLastMoveRef = useRef<
    { from: Source | Target; to: Target }[]
  >(state.lastMove ?? []);
  const humanMoveRef = useRef<{ from: Source | Target; to: Target } | null>(
    null,
  );

  const [autoPointSequenceActive, setAutoPointSequenceActive] = useState(false);
  const autoPointRunRef = useRef<{
    id: number;
    target: number;
    remaining: Move[];
    dispatched: { move: Move; fromState: GameState; toState: GameState; observedApplied: boolean } | null;
    timer: number | null;
  } | null>(null);
  const autoPointRunIdRef = useRef(0);
  const forcedExecRef = useRef<{ id: number; posKey: string; from: Source; to: Target } | null>(null);

  const clearAutoPointSequence = useCallback(
    (notify = true) => {
      const run = autoPointRunRef.current;
      autoPointRunRef.current = null;
      if (run?.timer != null) {
        window.clearTimeout(run.timer);
      }
      setAutoPointSequenceActive(false);
      if (notify) onAutoPointSequenceChangeRef.current?.(false);
    },
    [],
  );

  const flySourceCount = flyChecker
    ? checkerCountAt(state, flyChecker.from, flyChecker.color)
    : null;
  const flyMoveApplied = Boolean(
    flyChecker && flySourceCount !== null && flySourceCount < flyChecker.fromCount,
  );
  // Once the move is reflected on the board (including optimistic online
  // updates), further input is safe. The visual animation must not swallow it.
  const baseInteractionBlocked = Boolean(
    inputDisabled || (flyChecker && (flyChecker.external || !flyMoveApplied)),
  );
  const interactionBlocked = baseInteractionBlocked || autoPointSequenceActive;

  useEffect(() => {
    if (!flyChecker?.committed) return;
    const acknowledged =
      flySourceCount !== null && flySourceCount < flyChecker.fromCount;
    const t = setTimeout(
      () =>
        setFlyChecker((current) => (current === flyChecker ? null : current)),
      acknowledged ? 0 : 600,
    );
    return () => clearTimeout(t);
  }, [flyChecker, flySourceCount]);

  const lastMoveLast = useMemo(() => {
    const lm = state.lastMove;
    return lm && lm.length > 0 ? lm[lm.length - 1] : null;
  }, [state.lastMove]);

  const displayTopPoints = myColor === "black" ? BOTTOM_POINTS : TOP_POINTS;

  const displayBottomPoints = myColor === "black" ? TOP_POINTS : BOTTOM_POINTS;

  const bottomBearOffColor: Color = myColor ?? "white";

  const computeSlotY = useCallback(
    (
      el: HTMLElement,
      stackIndex: number,
      isTop: boolean,
      boardTop: number,
      checkerPx: number,
    ) => {
      const rect = el.getBoundingClientRect();
      const gap = 2;
      const pad = 8; // 0.5rem top/bottom padding on the checker stack
      // Returns the checker's TOP-LEFT corner so the flyer's translateY aligns.
      return isTop
        ? rect.top + pad + stackIndex * (checkerPx + gap) - boardTop
        : rect.top +
            rect.height -
            (pad + stackIndex * (checkerPx + gap) + checkerPx) -
            boardTop;
    },
    [],
  );

  const triggerFly = useCallback(
    (
      from: Source,
      to: Target,
      pointerOrigin?: { x: number; y: number },
      options?: MakeMoveOptions,
    ) => {
      const origin = pointerOrigin;
      humanMoveRef.current = { from, to };
      const board = boardRef.current;
      if (!board) {
        onMove(to, from, options);
        return;
      }
      const moverColor: Color = myColor ?? "white";
      const fromEl =
        (from as unknown) === OFF
          ? board.querySelector<HTMLElement>(
              `[data-testid="${moverColor === bottomBearOffColor ? "bear-off-bottom" : "bear-off-top"}"]`,
            ) ?? board.querySelector<HTMLElement>(`[data-point-idx="${from}"]`)
          : board.querySelector<HTMLElement>(`[data-point-idx="${from}"]`);
      const toEl =
        to === OFF
          ? board.querySelector<HTMLElement>(
              `[data-testid="${moverColor === bottomBearOffColor ? "bear-off-bottom" : "bear-off-top"}"]`,
            ) ?? board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`)
          : board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`);
      if (!fromEl || !toEl) {
        onMove(to, from, options);
        return;
      }

      // The flyer is positioned inside the wrapper, outside the inset frame.
      const bRect = (wrapperRef.current ?? board).getBoundingClientRect();
      const fRect = fromEl.getBoundingClientRect();
      const tRect = toEl.getBoundingClientRect();
      const checkerPx = getCheckerSize(board);

      // The checker being moved leaves from the TOP of the source stack.
      const fromCount =
        typeof from === "number"
          ? Math.abs(state.points[from] ?? 0)
          : Math.abs(state.bar[myColor ?? "white"] ?? 0);
      const fromStackIndex = Math.min(Math.max(fromCount - 1, 0), 4);
      const isFromTop =
        typeof from === "number" && displayTopPoints.includes(from);

      // The checker lands on TOP of the destination stack (count + 1).
      const targetValue = typeof to === "number" ? (state.points[to] ?? 0) : 0;
      // A hit replaces the opponent's blot; it does not add a stack slot.
      const toCount =
        (myColor === "black" ? targetValue < 0 : targetValue > 0)
          ? Math.abs(targetValue)
          : 0;
      const toStackIndex = Math.min(toCount, 4);
      const isToTop = typeof to === "number" && displayTopPoints.includes(to);

      const toX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
      const toY = computeSlotY(
        toEl,
        toStackIndex,
        isToTop,
        bRect.top,
        checkerPx,
      );
      const fromX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
      const fromY = computeSlotY(
        fromEl,
        fromStackIndex,
        isFromTop,
        bRect.top,
        checkerPx,
      );

      setFlyChecker({
        id: ++flightIdRef.current,
        fromX: origin ? origin.x - bRect.left - checkerPx / 2 : fromX,
        fromY: origin ? origin.y - bRect.top - checkerPx / 2 : fromY,
        toX,
        toY,
        from,
        fromCount,
        color: moverColor,
        size: checkerPx,
        to,
        committed: false,
      });
      // Dispatch immediately so the server/local engine works while the visual
      // animation is running instead of adding the animation time to every move.
      onMove(to, from, options);
    },
    [
      myColor,
      bottomBearOffColor,
      onMove,
      state.points,
      state.bar,
      displayTopPoints,
      computeSlotY,
    ],
  );

  const { drag, targets: dragTargets, handlers: dragHandlers } = useCheckerDrag({
    state, myColor, blocked: interactionBlocked, legalFromPoints, boardRef, wrapperRef,
    onDrop: triggerFly,
  });
  const displayedTargets = drag ? dragTargets : legalTargets;

  const animateExternalMove = useCallback(
    (from: Source | Target, to: Target, mover: Color) => {
      const board = boardRef.current;
      if (!board) return;
      const fromEl =
        from === OFF
          ? board.querySelector<HTMLElement>(
              `[data-testid="${mover === bottomBearOffColor ? "bear-off-bottom" : "bear-off-top"}"]`,
            ) ?? board.querySelector<HTMLElement>(`[data-point-idx="${from}"]`)
          : board.querySelector<HTMLElement>(`[data-point-idx="${from}"]`);
      const toEl =
        to === OFF
          ? board.querySelector<HTMLElement>(
              `[data-testid="${mover === bottomBearOffColor ? "bear-off-bottom" : "bear-off-top"}"]`,
            ) ?? board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`)
          : board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`);
      if (!fromEl || !toEl) return;

      const bRect = (wrapperRef.current ?? board).getBoundingClientRect();
      const fRect = fromEl.getBoundingClientRect();
      const tRect = toEl.getBoundingClientRect();
      const checkerPx = getCheckerSize(board);

      // The move is already applied to the state, so the checker flew from the
      // OLD top of the source stack (one slot above the current top) and landed
      // as the current top of the destination stack.
      const fromCount =
        typeof from === "number"
          ? Math.abs(state.points[from] ?? 0)
          : Math.abs(state.bar[mover] ?? 0);
      const isFromTop =
        typeof from === "number" && displayTopPoints.includes(from);

      const toCount =
        typeof to === "number" ? Math.abs(state.points[to] ?? 0) : 0;
      const isToTop = typeof to === "number" && displayTopPoints.includes(to);

      const fromStackIndex = Math.min(fromCount, 4);
      const toStackIndex = Math.min(Math.max(toCount - 1, 0), 4);

      const toX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
      const toY = computeSlotY(
        toEl,
        toStackIndex,
        isToTop,
        bRect.top,
        checkerPx,
      );
      const fromX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
      const fromY = computeSlotY(
        fromEl,
        fromStackIndex,
        isFromTop,
        bRect.top,
        checkerPx,
      );

      setFlyChecker({
        id: ++flightIdRef.current,
        fromX,
        fromY,
        toX,
        toY,
        from,
        fromCount: fromCount + 1,
        color: mover,
        size: checkerPx,
        to,
        external: true,
        committed: false,
      });
    },
    [state.points, state.bar, displayTopPoints, computeSlotY, bottomBearOffColor],
  );

  useEffect(() => {
    const lm = state.lastMove;
    const known = knownLastMoveRef.current;
    if (lm === null) {
      knownLastMoveRef.current = [];
      return;
    }
    if (lm.length <= known.length) {
      knownLastMoveRef.current = lm;
      return;
    }
    const newMoves = lm.slice(known.length);
    const last = newMoves[newMoves.length - 1];
    const isHuman =
      humanMoveRef.current !== null &&
      humanMoveRef.current.from === last.from &&
      humanMoveRef.current.to === last.to;
    knownLastMoveRef.current = lm;
    humanMoveRef.current = null;
    if (isHuman) return;
    // Replace a superseded flight instead of dropping the new server update.
    const mover: Color = myColor === "black" ? "white" : "black";
    animateExternalMove(last.from, last.to, mover);
  }, [state.lastMove, flyChecker, myColor, animateExternalMove]);

  useEffect(() => {
    if (autoPointRunRef.current) return;
    if (autoPointSequenceActive) return;
    if (!autoMove) {
      forcedExecRef.current = null;
      return;
    }
    if (inputDisabled) return;
    if (myColor === null) return;
    if (state.phase !== "moving" || state.turn !== myColor || state.winner) return;
    if (drag) return;
    const currentKey = getGameplayKey(state);
    if (currentKey !== autoMove.fromPositionKey) {
      forcedExecRef.current = null;
      return;
    }
    const currentForced = getAutomaticMove(state, myColor);
    if (!currentForced) {
      forcedExecRef.current = null;
      return;
    }
    if (
      currentForced.from !== autoMove.move.from ||
      currentForced.to !== autoMove.move.to ||
      currentForced.die !== autoMove.move.die
    ) {
      forcedExecRef.current = null;
      return;
    }
    const existing = forcedExecRef.current;
    if (existing && existing.id === autoMove.id) return;
    if (flyChecker) return;
    forcedExecRef.current = { id: autoMove.id, posKey: currentKey, from: autoMove.move.from, to: autoMove.move.to };
    triggerFly(autoMove.move.from, autoMove.move.to, undefined, { origin: "forced" });
  }, [autoMove, autoPointSequenceActive, flyChecker, state, myColor, inputDisabled, triggerFly, drag]);

  const handleUndo = useCallback(() => {
    if (autoPointRunRef.current) {
      const run = autoPointRunRef.current;
      if (run.timer !== null) window.clearTimeout(run.timer);
      // Cancel unsent remainder; current in-flight animation is allowed to finish
      if (run.remaining.length > 0 || run.dispatched) {
        clearAutoPointSequence(true);
      }
    }
    if (baseInteractionBlocked) return;
    const board = boardRef.current;
    const last = lastMoveLast;
    if (!board || !last) {
      onUndo?.();
      return;
    }
    const undoColor: Color = myColor ?? "white";
    const toEl =
      last.to === OFF
        ? board.querySelector<HTMLElement>(
            `[data-testid="${undoColor === bottomBearOffColor ? "bear-off-bottom" : "bear-off-top"}"]`,
          ) ?? board.querySelector<HTMLElement>(`[data-point-idx="${last.to}"]`)
        : board.querySelector<HTMLElement>(`[data-point-idx="${last.to}"]`);
    const fromEl = board.querySelector<HTMLElement>(`[data-point-idx="${last.from}"]`);
    if (!toEl || !fromEl) {
      onUndo?.();
      return;
    }

    const bRect = (wrapperRef.current ?? board).getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    const checkerPx = getCheckerSize(board);

    // Start from the TOP of the destination stack (the checker just moved there).
    const toCount = checkerCountAt(state, last.to, myColor ?? "white");
    const fromStackIndex = Math.min(Math.max(toCount - 1, 0), 4);
    const isFromTop =
      typeof last.to === "number" && displayTopPoints.includes(last.to);

    // Land on TOP of the source stack after the checker returns (count + 1).
    const fromCount =
      typeof last.from === "number"
        ? Math.abs(state.points[last.from] ?? 0)
        : 0;
    const toStackIndex = Math.min(fromCount, 4);
    const isToTop =
      typeof last.from === "number" && displayTopPoints.includes(last.from);

    const toX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
    const toY = computeSlotY(
      fromEl,
      toStackIndex,
      isToTop,
      bRect.top,
      checkerPx,
    );
    const fromX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
    const fromY = computeSlotY(
      toEl,
      fromStackIndex,
      isFromTop,
      bRect.top,
      checkerPx,
    );

    setFlyChecker({
      id: ++flightIdRef.current,
      fromX,
      fromY,
      toX,
      toY,
      from: last.to,
      fromCount: toCount,
      color: myColor ?? "white",
      size: checkerPx,
      to: last.from,
      undo: true,
      committed: false,
    });
    onUndo?.();
  }, [
    myColor,
    bottomBearOffColor,
    onUndo,
    state,
    displayTopPoints,
    computeSlotY,
    lastMoveLast,
    baseInteractionBlocked,
    clearAutoPointSequence,
  ]);

  // Auto make-point sequence: advance on state + animation completion
  // Auto make-point sequence: advance on state + animation completion
  useEffect(() => {
    const run = autoPointRunRef.current;
    if (!run || !run.dispatched) return;
    if (inputDisabled || myColor === null || state.turn !== myColor || state.phase !== "moving") {
      return;
    }
    const step = run.dispatched;
    if (gameplayEqual(state, step.toState)) {
      step.observedApplied = true;
      if (run.timer !== null) {
        window.clearTimeout(run.timer);
        run.timer = null;
      }
    } else if (gameplayEqual(state, step.fromState)) {
      if (!step.observedApplied) return;
      clearAutoPointSequence(true);
      return;
    } else {
      clearAutoPointSequence(true);
      return;
    }
    if (flyChecker) return;
    if (run.remaining.length === 0) {
      clearAutoPointSequence(true);
      return;
    }
    const nextMove = run.remaining[0];
    const legal = allLegalMoves(state, myColor as Color).some(
      (m) => m.from === nextMove.from && m.to === nextMove.to && m.die === nextMove.die,
    );
    if (!legal) {
      clearAutoPointSequence(true);
      return;
    }
    const fromState = state;
    const toState = applyMove(fromState, nextMove, myColor as Color);
    const newStep = { move: nextMove, fromState, toState, observedApplied: false };
    run.remaining = run.remaining.slice(1);
    run.dispatched = newStep;
    const capturedRun = run;
    const capturedStep = newStep;
    capturedRun.timer = window.setTimeout(() => {
      if (autoPointRunRef.current !== capturedRun) return;
      if (capturedRun.dispatched !== capturedStep) return;
      if (capturedStep.observedApplied) return;
      clearAutoPointSequence(true);
    }, 2000);
    triggerFly(nextMove.from, nextMove.to);
  }, [state, flyChecker, myColor, inputDisabled, clearAutoPointSequence, triggerFly]);

  useEffect(() => {
    return () => {
      const run = autoPointRunRef.current;
      autoPointRunRef.current = null;
      if (run?.timer != null) window.clearTimeout(run.timer);
      if (run) {
        onAutoPointSequenceChangeRef.current?.(false);
      }
    };
  }, []);

  function hideTopCheckerAt(idx: number) {
    if (drag?.from === idx) return true;
    if (!flyChecker) return false;
    if (flyChecker.external) return flyChecker.to === idx;
    const stateApplied =
      flySourceCount !== null && flySourceCount < flyChecker.fromCount;
    return stateApplied ? flyChecker.to === idx : flyChecker.from === idx;
  }

  const handleClick = useCallback((idx: Source) => {
    if (interactionBlocked || autoPointRunRef.current !== null) return;
    // Destination-click make-point shortcut (no source selected)
    if (
      selected === null &&
      typeof idx === "number" &&
      myColor !== null &&
      state.turn === myColor &&
      state.phase === "moving"
    ) {
      const seq = getMakePointSequence(state, myColor, idx);
      if (seq && seq.length > 0) {
        // Validate again against live legal moves for the first step
        const firstLegal = allLegalMoves(state, myColor).some(
          (m) => m.from === seq[0].from && m.to === seq[0].to && m.die === seq[0].die,
        );
        if (firstLegal) {
          const fromState = state;
          const toState = applyMove(fromState, seq[0], myColor);
          const runId = ++autoPointRunIdRef.current;
          const newStep = { move: seq[0], fromState, toState, observedApplied: false };
          const run = {
            id: runId,
            target: idx,
            remaining: seq.slice(1),
            dispatched: newStep,
            timer: null as number | null,
          };
          autoPointRunRef.current = run;
          setAutoPointSequenceActive(true);
          onAutoPointSequenceChangeRef.current?.(true);
          run.timer = window.setTimeout(() => {
            if (autoPointRunRef.current !== run) return;
            if (run.dispatched !== newStep) return;
            if (newStep.observedApplied) return;
            clearAutoPointSequence(true);
          }, 2000);
          triggerFly(seq[0].from, seq[0].to);
          return;
        }
      }
    }
    if (typeof idx === "number" && legalTargets.includes(idx)) {
      if (selected !== null) {
        triggerFly(selected, idx);
        return;
      }
      onMove(idx);
      return;
    }
    if (selected === idx) {
      if (legalTargets.length === 1) {
        triggerFly(selected, legalTargets[0]);
      } else if (idx !== BAR || legalFromPoints.length > 1) {
        onSelect(null);
      }
    } else if (legalFromPoints.includes(idx)) {
      if (myColor === null) return;
      const moves = legalMovesFrom(state, idx, myColor);
      const targets = Array.from(new Set(moves.map((m) => m.to)));
      const directMove =
        targets.length === 1 ? moves[0] : preferredDirectMove(moves, state.remaining);
      if (directMove) {
        onSelect(idx);
        triggerFly(idx, directMove.to);
      } else {
        onSelect(idx);
      }
    }
  }, [
    interactionBlocked,
    legalTargets,
    selected,
    triggerFly,
    onMove,
    legalFromPoints,
    myColor,
    state,
    onSelect,
    clearAutoPointSequence,
  ]);

  // Point cells are memoized. Keep the callback passed to all 24 cells stable,
  // while still invoking the newest interaction logic after every state change.
  const handleClickRef = useRef(handleClick);
  useLayoutEffect(() => {
    handleClickRef.current = handleClick;
  }, [handleClick]);
  const handlePointClick = useCallback((idx: number) => {
    handleClickRef.current(idx);
  }, []);

  const canUndo =
    Boolean(onUndo) &&
    state.turn === myColor &&
    Boolean(state.moveHistory?.length) &&
    state.phase === "moving";
  const canConfirm =
    Boolean(onConfirm) &&
    !autoPointSequenceActive &&
    state.phase === "moving" &&
    state.turn === myColor &&
    state.remaining.length === 0;
  const canRoll =
    Boolean(onRoll) &&
    (state.phase === "opening_roll" || state.phase === "rolling") &&
    state.turn === myColor &&
    state.remaining.length === 0;
  const canDouble =
    Boolean(onOfferDouble) &&
    myColor !== null &&
    canOfferDouble(state, myColor);
  const cubePosition =
    state.cubeOwner === "center"
      ? "center"
      : state.cubeOwner === myColor
        ? "bottom"
        : "top";

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      dir="ltr"
      data-testid="board-wrapper"
    >
      <div
        ref={boardRef}
        className={`${styles.frame} ${drag ? dragStyles.dragging : ""}`}
        {...dragHandlers}
        dir="ltr"
        style={{ touchAction: "none" }}
      >
        <div className={styles.inner}>
          <div className={styles.column12}>
            <div className={styles.row6}>
              {displayTopPoints.slice(0, 6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  pointNumber={pointNumberFor(idx, myColor)}
                  top
                  pointValue={state.points[idx] ?? 0}
                  selected={(drag?.from ?? selected) === idx}
                  isLegalTarget={displayedTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={handlePointClick}
                  hideTopChecker={hideTopCheckerAt(idx)}
                />
              ))}
            </div>
            <div className={styles.row6}>
              {/* Bottom point numbers are owned by PointCell and rendered at outer bottom edge */}
              {displayBottomPoints.slice(0, 6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  pointNumber={pointNumberFor(idx, myColor)}
                  pointValue={state.points[idx] ?? 0}
                  selected={(drag?.from ?? selected) === idx}
                  isLegalTarget={displayedTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={handlePointClick}
                  hideTopChecker={hideTopCheckerAt(idx)}
                />
              ))}
            </div>
          </div>

          <Bar
            state={state}
            myColor={myColor}
            selected={(drag?.from ?? selected) === BAR}
            isLegalFrom={legalFromPoints.includes(BAR)}
            onClick={() => handleClick(BAR)}
            hideChecker={
              drag?.from === BAR ? drag.color : flyChecker &&
              flyChecker.from === BAR &&
              Math.abs(state.bar[flyChecker.color] ?? 0) ===
                flyChecker.fromCount
                ? flyChecker.color
                : null
            }
            doublingCube={
              <DoublingCube
                value={state.phase === "doubling_offered" ? state.cube * 2 : state.cube}
                owner={state.cubeOwner}
                showOwner={false}
              />
            }
            cubePosition={cubePosition}
          />

          <div className={styles.column12}>
            <div className={styles.row6}>
              {displayTopPoints.slice(6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  pointNumber={pointNumberFor(idx, myColor)}
                  top
                  pointValue={state.points[idx] ?? 0}
                  selected={(drag?.from ?? selected) === idx}
                  isLegalTarget={displayedTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={handlePointClick}
                  hideTopChecker={hideTopCheckerAt(idx)}
                />
              ))}
            </div>
            <div className={styles.row6}>
              {displayBottomPoints.slice(6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  pointNumber={pointNumberFor(idx, myColor)}
                  pointValue={state.points[idx] ?? 0}
                  selected={(drag?.from ?? selected) === idx}
                  isLegalTarget={displayedTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={handlePointClick}
                  hideTopChecker={hideTopCheckerAt(idx)}
                />
              ))}
            </div>
          </div>

          <BearOff
            state={state}
            myColor={myColor}
            isLegalTarget={displayedTargets.includes(OFF)}
            onClick={() =>
              !interactionBlocked &&
              legalTargets.includes(OFF) &&
              triggerFly(selected ?? 0, OFF)
            }
          />
        </div>

        {(turnNotice || canUndo || canRoll) && (
          <div
            className={turnNotice ? styles.boardTurnNotice : styles.boardUndoAction}
            data-testid={
              !turnNotice ? undefined : turnNotice.variant === "no-moves"
                ? "no-moves-overlay"
                : "forced-move-notice"
            }
          >
            {turnNotice && <GuidanceBanner message={turnNotice} inline />}
            <div className={turnNotice ? styles.boardNoticeActions : undefined}>
              {canUndo && <UndoButton onClick={handleUndo} />}
              {canRoll && (
                <button
                  type="button"
                  className={`${styles.boardTurnButton} ${styles.boardTurnButtonSecondary}`}
                  onClick={onOfferDouble}
                  disabled={!canDouble}
                  title={t("common.offerDouble")}
                  aria-label={t("common.offerDouble")}
                >
                  {t("common.offerDoubleShort")}
                </button>
              )}
            </div>
          </div>
        )}
        {canConfirm && (
          <div className={styles.boardConfirmAction}>
            <ConfirmButton onClick={onConfirm} />
          </div>
        )}
        {canRoll && (
          <div className={styles.boardRollAction}>
            <button
              type="button"
              className={`${styles.boardTurnButton} ${styles.boardTurnButtonPrimary}`}
              onClick={onRoll}
              title={t("common.tapToRoll")}
            >
              {t("game.rollNow")}
            </button>
          </div>
        )}
      </div>

      {drag && (
        <div
          aria-hidden="true"
          data-testid="dragging-checker"
          className={dragStyles.ghost}
          style={{
            left: drag.x - drag.boardLeft - drag.size / 2,
            top: drag.y - drag.boardTop - drag.size / 2,
            width: drag.size,
            height: drag.size,
            "--checker": `${drag.size}px`,
          } as React.CSSProperties}
        >
          <Checker color={drag.color} />
        </div>
      )}
      {flyChecker && (
        <FlyingChecker
          key={flyChecker.id}
          from={{ x: flyChecker.fromX, y: flyChecker.fromY }}
          to={{ x: flyChecker.toX, y: flyChecker.toY }}
          color={flyChecker.color}
          size={flyChecker.size}
          committed={flyChecker.committed}
          onComplete={() => {
            setFlyChecker((current) => {
              if (current?.id !== flyChecker.id) return current;
              return current.external || flyMoveApplied
                ? null
                : { ...current, committed: true };
            });
          }}
        />
      )}
    </div>
  );
}
