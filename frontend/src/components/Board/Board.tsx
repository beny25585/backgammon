import { boardRect, boardPoint } from "./boardCoordinates";
import { bearOffSlot } from "./bearOffSlot";
import {
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import type { ReactNode } from "react";
import type { GameState, Color, Source, Target, MatchContext } from "@/lib/backgammon/engine";
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
import BoardActions from "./BoardActions";
import type { BoardSide } from "./BoardHalfOverlay";
import PointCell from "./pieces/pointcell/PointCell";
import Bar from "./pieces/bar/Bar";
import BearOff from "./pieces/bearoff/BearOff";
import FlyingChecker from "../animations/FlyingChecker/FlyingChecker";
import DoublingCube from "../DoublingCube";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import styles from "../GameScreen/GameScreen.module.css";
import { TOP_POINTS, BOTTOM_POINTS } from "./layout";
import Checker from "./pieces/checker/Checker";
import { useCheckerDrag } from "./useCheckerDrag";
import dragStyles from "./CheckerDrag.module.css";
import charcoalLeather from "../../assets/6b-charcoal-leather.png";
import PixiBoardSkin from "./materials/PixiBoardSkin";
import { useBoardMaterials } from "./materials/boardMaterialContext";

interface BoardProps {
  state: GameState;
  match?: MatchContext;
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
  hasPendingMoves?: () => boolean;
  turnNotice?: GuidanceMessage | null;
  noticeSide?: BoardSide;
  noticeDetails?: ReactNode;
  rollDetails?: Partial<Record<BoardSide, ReactNode>>;
  overlay?: ReactNode;
  onAutoPointSequenceChange?: (active: boolean) => void;
  onControlsTargetChange?: (target: HTMLDivElement | null) => void;
}

function getCheckerSize(board: HTMLElement): number {
  const checkerEl = board.querySelector<HTMLElement>("[data-checker]");
  if (!checkerEl) return 30;
  return boardRect(checkerEl).width;
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

// Deliberate vertical clearance (CSS px) kept free inside each point so the
// top and bottom five-checker stacks never visually touch at the board center
// on short landscape phones, where fractional-pixel and device-pixel rounding
// can otherwise close an exact edge-to-edge fit.
const CHECKER_STACK_CLEARANCE_PX = 8;

export function Board({
  state,
  match,
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
  hasPendingMoves,
  turnNotice,
  noticeSide,
  noticeDetails,
  rollDetails,
  overlay,
  onAutoPointSequenceChange,
  onControlsTargetChange,
}: BoardProps) {
  const materials = useBoardMaterials();
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onAutoPointSequenceChangeRef = useRef(onAutoPointSequenceChange);
  useLayoutEffect(() => {
    onAutoPointSequenceChangeRef.current = onAutoPointSequenceChange;
  }, [onAutoPointSequenceChange]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const point = board?.querySelector<HTMLElement>("[data-point-idx]");
    const stack = point?.lastElementChild;
    if (!board || !point || !(stack instanceof HTMLElement)) return;

    const fitCheckers = () => {
      if (point.clientHeight <= 0) return;
      const style = getComputedStyle(stack);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const gaps = 4 * (parseFloat(style.rowGap) || 0);
      // All points have the same height. Reserve space for five full circles,
      // stack padding, four gaps and a deliberate safety clearance, even on a
      // short landscape viewport. The result is floored to a whole CSS pixel
      // so physical devices never rely on subpixel rounding for the fit.
      const rowHeight = point.parentElement?.clientHeight ?? point.clientHeight;
      const availableHeight = Math.min(point.clientHeight, rowHeight) - padding - gaps - CHECKER_STACK_CLEARANCE_PX;
      const size = Math.max(0, Math.floor(availableHeight / 5));
      const limit = `${size}px`;
      if (board.style.getPropertyValue("--checker-height-limit") !== limit) {
        board.style.setProperty("--checker-height-limit", limit);
      }
    };
    fitCheckers();
    let fitFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (fitFrame !== null) return;
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        fitCheckers();
      });
    });
    observer.observe(point);
    if (point.parentElement) observer.observe(point.parentElement);
    // CSS can arrive after mount without changing the point's outer size.
    observer.observe(stack);
    return () => {
      observer.disconnect();
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
    };
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
    color: Color;
    remaining: Move[];
    dispatched: { move: Move; fromState: GameState; toState: GameState; observedApplied: boolean } | null;
    timer: number | null;
  } | null>(null);
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

  const bearOffMove = useMemo(() => {
    if (myColor === null || state.turn !== myColor || state.phase !== "moving") return null;
    const moves = allLegalMoves(state, myColor).filter(
      (move) => move.to === OFF && (selected === null || move.from === selected),
    );
    return preferredDirectMove(moves, [...state.remaining].sort((a, b) => b - a));
  }, [state, myColor, selected]);

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
      trayCount?: number,
    ) => {
      if (el.dataset.pointIdx === OFF) {
        return bearOffSlot(el, trayCount ?? 1, stackIndex, checkerPx).y - boardTop;
      }
      const rect = boardRect(el);
      const stack = el.querySelector<HTMLElement>("[data-checker-stack]");
      const stackStyle = stack ? getComputedStyle(stack) : null;
      const gap = stackStyle ? parseFloat(stackStyle.rowGap) || 0 : 2;
      const pad = stackStyle
        ? parseFloat(isTop ? stackStyle.paddingTop : stackStyle.paddingBottom) || 0
        : 8;
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
      const origin = pointerOrigin && boardRef.current ? boardPoint(boardRef.current, pointerOrigin) : pointerOrigin;
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
      const bRect = boardRect(wrapperRef.current ?? board);
      const fRect = boardRect(fromEl);
      const tRect = boardRect(toEl);
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
      const toStackIndex = to === OFF ? Math.min(state.home[moverColor], 14) : Math.min(toCount, 4);
      const isToTop = typeof to === "number" && displayTopPoints.includes(to);

      const toX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
      const toY = computeSlotY(
        toEl,
        toStackIndex,
        isToTop,
        bRect.top,
        checkerPx,
        to === OFF ? state.home[moverColor] + 1 : undefined,
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
      state.home,
      displayTopPoints,
      computeSlotY,
    ],
  );

  const dispatchSequenceMove = useCallback(
    (origin?: { x: number; y: number }) => {
      const run = autoPointRunRef.current;
      const move = run?.remaining[0];
      if (!run || !move || myColor === null) return;
      const legal = allLegalMoves(state, myColor).some(
        candidate => candidate.from === move.from && candidate.to === move.to && candidate.die === move.die,
      );
      if (!legal) {
        clearAutoPointSequence();
        return;
      }
      const step = {
        move,
        fromState: state,
        toState: applyMove(state, move, myColor),
        observedApplied: false,
      };
      run.remaining = run.remaining.slice(1);
      run.dispatched = step;
      run.timer = window.setTimeout(() => {
        if (autoPointRunRef.current === run && run.dispatched === step) {
          clearAutoPointSequence();
        }
      }, 2000);
      triggerFly(move.from, move.to, origin, { die: move.die });
    },
    [state, myColor, clearAutoPointSequence, triggerFly],
  );

  const startMoveSequence = useCallback(
    (moves: Move[], origin?: { x: number; y: number }) => {
      if (
        !moves.length || myColor === null || inputDisabled ||
        state.turn !== myColor || state.phase !== "moving" || autoPointRunRef.current
      ) return;
      const first = moves[0];
      const legal = allLegalMoves(state, myColor).some(
        move => move.from === first.from && move.to === first.to && move.die === first.die,
      );
      if (!legal) return;
      if (moves.length === 1) {
        triggerFly(first.from, first.to, origin, { die: first.die });
        return;
      }
      autoPointRunRef.current = {
        color: myColor,
        remaining: [...moves],
        dispatched: null,
        timer: null,
      };
      setAutoPointSequenceActive(true);
      onAutoPointSequenceChangeRef.current?.(true);
      dispatchSequenceMove(origin);
    },
    [state, myColor, inputDisabled, triggerFly, dispatchSequenceMove],
  );

  const { drag, pointerDown, hasPointerInteraction, targets: dragTargets, handlers: dragHandlers } = useCheckerDrag({
    state, myColor, blocked: interactionBlocked, legalFromPoints, boardRef, wrapperRef,
    onDrop: startMoveSequence,
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

      const bRect = boardRect(wrapperRef.current ?? board);
      const fRect = boardRect(fromEl);
      const tRect = boardRect(toEl);
      const checkerPx = getCheckerSize(board);

      // The move is already applied to the state, so the checker flew from the
      // OLD top of the source stack (one slot above the current top) and landed
      // as the current top of the destination stack.
      const fromCount = checkerCountAt(state, from, mover);
      const isFromTop =
        typeof from === "number" && displayTopPoints.includes(from);

      const toCount = checkerCountAt(state, to, mover);
      const isToTop = typeof to === "number" && displayTopPoints.includes(to);

      const fromStackIndex = Math.min(fromCount, from === OFF ? 14 : 4);
      const toStackIndex = Math.min(Math.max(toCount - 1, 0), to === OFF ? 14 : 4);

      const toX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
      const toY = computeSlotY(
        toEl,
        toStackIndex,
        isToTop,
        bRect.top,
        checkerPx,
        to === OFF ? toCount : undefined,
      );
      const fromX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
      const fromY = computeSlotY(
        fromEl,
        fromStackIndex,
        isFromTop,
        bRect.top,
        checkerPx,
        from === OFF ? fromCount + 1 : undefined,
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
    [state, displayTopPoints, computeSlotY, bottomBearOffColor],
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
    const mover: Color = myColor === null ? state.turn : myColor === "black" ? "white" : "black";
    animateExternalMove(last.from, last.to, mover);
  }, [state.lastMove, state.turn, flyChecker, myColor, animateExternalMove]);

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
    if (pointerDown || hasPointerInteraction()) return;
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
  }, [autoMove, autoPointSequenceActive, flyChecker, state, myColor, inputDisabled, triggerFly, pointerDown, hasPointerInteraction]);

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

    const bRect = boardRect(wrapperRef.current ?? board);
    const tRect = boardRect(toEl);
    const fRect = boardRect(fromEl);
    const checkerPx = getCheckerSize(board);

    // Start from the TOP of the destination stack (the checker just moved there).
    const toCount = checkerCountAt(state, last.to, myColor ?? "white");
    const fromStackIndex = Math.min(Math.max(toCount - 1, 0), last.to === OFF ? 14 : 4);
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
      last.to === OFF ? toCount : undefined,
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

  // Shared by make-point clicks and multi-die checker drags. Online optimistic
  // positions do not acknowledge a step until its server move is no longer pending.
  useEffect(() => {
    const run = autoPointRunRef.current;
    if (!run || !run.dispatched) return;
    if (inputDisabled || myColor === null || run.color !== myColor || state.turn !== myColor || state.phase !== "moving") {
      clearAutoPointSequence();
      return;
    }
    const step = run.dispatched;
    if (gameplayEqual(state, step.toState)) {
      step.observedApplied = true;
      if (hasPendingMoves?.()) return;
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
    dispatchSequenceMove();
  }, [state, flyChecker, myColor, inputDisabled, hasPendingMoves, clearAutoPointSequence, dispatchSequenceMove]);

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
    if (idx === BAR) {
      if (myColor === null || !legalFromPoints.includes(BAR)) return;
      const move = preferredDirectMove(
        legalMovesFrom(state, BAR, myColor),
        state.remaining,
      );
      if (move) triggerFly(BAR, move.to);
      return;
    }
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
        startMoveSequence(seq);
        return;
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
      } else {
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
    startMoveSequence,
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
    canOfferDouble(state, myColor, match);
  const cubePosition =
    state.cubeOwner === "center"
      ? "center"
      : state.cubeOwner === (myColor ?? "white")
        ? "bottom"
        : "top";

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} [--checker:var(--board-checker-size,6.7cqw)] [--bar-w:var(--board-bar-width,7cqw)] [--bearoff-w:clamp(48px,6cqw,56px)] [background:var(--lux-board-area-bg,var(--lux-rail-bg))]`}
      dir="ltr"
      data-testid="board-wrapper"
      style={{ "--board-leather-image": `url("${charcoalLeather}")` } as React.CSSProperties}
    >
      <div
        ref={boardRef}
        className={`absolute inset-[var(--board-frame-inset,clamp(7px,0.7vw,11px))] box-border overflow-visible rounded-[10px] py-[var(--board-number-rim)] pl-[var(--board-frame-pad-start,clamp(8px,0.9vw,13px))] pr-[var(--board-frame-pad-end,clamp(8px,0.9vw,13px))] [--board-number-rim:var(--board-frame-pad-block,20px)] [background:var(--lux-rail-bg)] @max-[620px]/game-layout:inset-0 @max-[620px]/game-layout:rounded-md @max-[620px]/game-layout:px-1 @max-[620px]/game-layout:[--board-number-rim:calc(var(--point-number-gutter)-7px)] ${drag ? dragStyles.dragging : ""}`}
        data-testid="board-inner-frame"
        data-board-material={materials.ready ? "pixi" : "native"}
        {...dragHandlers}
        dir="ltr"
        style={{ touchAction: "none" }}
      >
        <PixiBoardSkin rootRef={boardRef} />
        {!materials.ready && <>
        <span aria-hidden="true" data-board-depth="outer-wall" className="pointer-events-none absolute inset-0 translate-y-[5px] rounded-[11px] bg-[#060909] shadow-[2px_7px_7px_#000000b3,5px_13px_16px_#00000066] @max-[620px]/game-layout:translate-y-0.5 @max-[620px]/game-layout:rounded-md" />
        <span aria-hidden="true" data-board-depth="outer-bevel" className="pointer-events-none absolute inset-0 rounded-[10px] border border-[var(--lux-case-border,#a4824680)] [background:linear-gradient(135deg,#d2c39880,#4e51483d_3px,#070b09_7px,#171d17_98%,#050806)] shadow-[inset_1px_1px_0_#ffffff2e,inset_-2px_-3px_1px_#000000cc] @max-[620px]/game-layout:rounded-md" />
        <span aria-hidden="true" data-board-depth="rim-face" className="pointer-events-none absolute inset-[4px] rounded-[7px] [background:var(--lux-rail-bg)] shadow-[inset_1px_1px_2px_#ffffff1a,inset_-1px_-2px_2px_#00000099] @max-[620px]/game-layout:inset-0.5 @max-[620px]/game-layout:rounded" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-[inherit] opacity-[var(--lux-board-texture-opacity,0)] mix-blend-soft-light [background-image:var(--lux-board-texture,none)] bg-size-[480px_480px]" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[4px] z-3 rounded-[7px] border border-t-white/12 border-l-white/10 border-r-black/60 border-b-black/80 @max-[620px]/game-layout:inset-0.5 @max-[620px]/game-layout:rounded"
        />
        </>}
        <div className={`${styles.inner} ${materials.ready ? "[--lux-field-bg:transparent] [--lux-field-sheen:none] [--lux-row-bg:none]" : ""} ${materials.ready && materials.theme !== "charcoalGold" ? "[--lux-center-belt:transparent]" : ""}`} data-testid="board-inner">
          {!materials.ready && <>
          <span aria-hidden="true" data-board-depth="inner-wall" className="pointer-events-none absolute -inset-[4px] z-3 rounded-[5px] border-[4px] border-t-[#050807] border-l-[#070b09] border-r-[#3d4435] border-b-[#464a3c] shadow-[0_1px_0_#c6bd9b52,0_-1px_0_#000000cc] @max-[620px]/game-layout:-inset-0.5 @max-[620px]/game-layout:border-2" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] opacity-[var(--lux-board-texture-opacity,0)] mix-blend-soft-light [background-image:var(--lux-board-texture,none)] bg-size-[480px_480px]" />
          <span aria-hidden="true" data-board-depth="recess-contact" className="pointer-events-none absolute inset-0 z-3 rounded-[inherit] shadow-[inset_3px_4px_7px_#000000a6,inset_-1px_-2px_2px_#ffffff0a]" />
          </>}
          <div className="relative z-1 col-start-1 row-start-1 grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-[var(--board-center-gap,clamp(6px,0.72cqw,11px))]" data-testid="board-half-left">
            <div className={`${styles.row6} grid-rows-[minmax(0,1fr)]`}>
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
            <div className={`${styles.row6} grid-rows-[minmax(0,1fr)]`}>
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

          <div className="relative z-1 col-start-3 row-start-1 grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-[var(--board-center-gap,clamp(6px,0.72cqw,11px))]" data-testid="board-half-right">
            <div className={`${styles.row6} grid-rows-[minmax(0,1fr)]`}>
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
            <div className={`${styles.row6} grid-rows-[minmax(0,1fr)]`}>
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
            onControlsTargetChange={onControlsTargetChange}
            state={state}
            myColor={myColor}
            isLegalTarget={!interactionBlocked && (drag ? displayedTargets.includes(OFF) : bearOffMove !== null)}
            onClick={() => {
              if (interactionBlocked || !bearOffMove) return;
              triggerFly(bearOffMove.from, OFF, undefined, { die: bearOffMove.die });
            }}
          />
          <div
            className="pointer-events-none relative z-40 col-span-full row-start-1 grid min-h-0 grid-cols-subgrid [--board-action-width:clamp(60px,14.5cqw,104px)] [--board-action-face-height:clamp(27px,5.5cqw,40px)] [--board-action-font:clamp(11px,1.8cqw,12px)]"
            data-testid="board-overlays"
          >
            <BoardActions
              canUndo={canUndo}
              canConfirm={canConfirm}
              canRoll={canRoll}
              canDouble={canDouble}
              onUndo={handleUndo}
              onConfirm={onConfirm}
              onRoll={onRoll}
              onDouble={onOfferDouble}
              turnNotice={turnNotice}
              noticeSide={noticeSide}
              noticeDetails={noticeDetails}
              rollDetails={rollDetails}
            />
            {overlay}
          </div>
        </div>
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
