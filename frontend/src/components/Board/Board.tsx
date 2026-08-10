import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import { BAR, OFF } from "@/lib/backgammon/engine";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import PointCell from "./pieces/pointcell/PointCell";
import Bar from "./pieces/bar/Bar";
import BearOff from "./pieces/bearoff/BearOff";
import FlyingChecker from "../animations/FlyingChecker/FlyingChecker";
import styles from "../GameScreen/GameScreen.module.css";
import { TOP_POINTS, BOTTOM_POINTS } from "./layout";

interface BoardProps {
  state: GameState;
  myColor: Color | null;
  selected: Source | null;
  legalTargets: Target[];
  onSelect: (from: Source | null) => void;
  onMove: (to: Target) => void;
  legalFromPoints: Source[];
  onUndo?: () => void;
  onConfirm?: () => void;
}

function getCheckerSize(board: HTMLElement): number {
  const checkerEl = board.querySelector<HTMLElement>("[data-checker]");
  if (!checkerEl) return 30;
  return checkerEl.getBoundingClientRect().width;
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
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [flyChecker, setFlyChecker] = useState<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    color: Color;
    size: number;
    to: Source | Target;
    undo?: boolean;
    committed: boolean;
    pending:
      | { kind: "move"; historyLen: number }
      | { kind: "undo"; historyLen: number };
  } | null>(null);

  const [undoLanding, setUndoLanding] = useState<Source | null>(null);

  useEffect(() => {
    setUndoLanding(null);
  }, [state.points]);

  useEffect(() => {
    if (!flyChecker?.committed) return;
    const len = state.moveHistory?.length ?? 0;
    const { kind, historyLen } = flyChecker.pending;
    const landed =
      kind === "move" ? len >= historyLen + 1 : len <= historyLen - 1;
    if (landed) setFlyChecker(null);
  }, [flyChecker, state.moveHistory]);

  useEffect(() => {
    if (!flyChecker?.committed) return;
    const t = setTimeout(() => setFlyChecker(null), 1200);
    return () => clearTimeout(t);
  }, [flyChecker?.committed]);

  const lastMoveLast = useMemo(() => {
    const lm = state.lastMove;
    return lm && lm.length > 0 ? lm[lm.length - 1] : null;
  }, [state.lastMove]);

  const displayTopPoints = myColor === "black" ? BOTTOM_POINTS : TOP_POINTS;

  const displayBottomPoints = myColor === "black" ? TOP_POINTS : BOTTOM_POINTS;

  const computeSlotY = useCallback(
    (el: HTMLElement, stackIndex: number, isTop: boolean, boardTop: number, checkerPx: number) => {
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
    (from: Source, to: Target) => {
      const board = boardRef.current;
      if (!board) {
        onMove(to);
        return;
      }
      const fromEl = board.querySelector<HTMLElement>(
        `[data-point-idx="${from}"]`,
      );
      const toEl = board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`);
      if (!fromEl || !toEl) {
        onMove(to);
        return;
      }

      const bRect = board.getBoundingClientRect();
      const fRect = fromEl.getBoundingClientRect();
      const tRect = toEl.getBoundingClientRect();
      const checkerPx = getCheckerSize(board);

      // The checker being moved leaves from the TOP of the source stack.
      const fromCount =
        typeof from === "number" ? Math.abs(state.points[from] ?? 0) : 0;
      const fromStackIndex = Math.min(Math.max(fromCount - 1, 0), 4);
      const isFromTop =
        typeof from === "number" && displayTopPoints.includes(from);

      // The checker lands on TOP of the destination stack (count + 1).
      const toCount = typeof to === "number" ? Math.abs(state.points[to] ?? 0) : 0;
      const toStackIndex = Math.min(toCount, 4);
      const isToTop = typeof to === "number" && displayTopPoints.includes(to);

      const toX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
      const toY = computeSlotY(toEl, toStackIndex, isToTop, bRect.top, checkerPx);
      const fromX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
      const fromY = computeSlotY(fromEl, fromStackIndex, isFromTop, bRect.top, checkerPx);

      setFlyChecker({
        fromX,
        fromY,
        toX,
        toY,
        color: myColor ?? "white",
        size: checkerPx,
        to,
        committed: false,
        pending: { kind: "move", historyLen: state.moveHistory?.length ?? 0 },
      });
    },
    [myColor, onMove, state.points, displayTopPoints, computeSlotY],
  );

  const handleUndo = useCallback(() => {
    if (flyChecker) return;
    const board = boardRef.current;
    const last = lastMoveLast;
    if (!board || !last) {
      onUndo?.();
      return;
    }
    const toEl = board.querySelector<HTMLElement>(`[data-point-idx="${last.to}"]`);
    const fromEl = board.querySelector<HTMLElement>(`[data-point-idx="${last.from}"]`);
    if (!toEl || !fromEl) {
      onUndo?.();
      return;
    }

    const bRect = board.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    const checkerPx = getCheckerSize(board);

    // Start from the TOP of the destination stack (the checker just moved there).
    const toCount =
      typeof last.to === "number" ? Math.abs(state.points[last.to] ?? 0) : 0;
    const fromStackIndex = Math.min(Math.max(toCount - 1, 0), 4);
    const isFromTop =
      typeof last.to === "number" && displayTopPoints.includes(last.to);

    // Land on TOP of the source stack after the checker returns (count + 1).
    const fromCount =
      typeof last.from === "number" ? Math.abs(state.points[last.from] ?? 0) : 0;
    const toStackIndex = Math.min(fromCount, 4);
    const isToTop =
      typeof last.from === "number" && displayTopPoints.includes(last.from);

    const toX = fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2;
    const toY = computeSlotY(fromEl, toStackIndex, isToTop, bRect.top, checkerPx);
    const fromX = tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2;
    const fromY = computeSlotY(toEl, fromStackIndex, isFromTop, bRect.top, checkerPx);

    setFlyChecker({
      fromX,
      fromY,
      toX,
      toY,
      color: myColor ?? "white",
      size: checkerPx,
      to: last.from,
      undo: true,
      committed: false,
      pending: { kind: "undo", historyLen: state.moveHistory?.length ?? 0 },
    });
    setUndoLanding(last.from);
  }, [myColor, onUndo, state.points, displayTopPoints, computeSlotY, lastMoveLast, flyChecker]);

  function handleClick(idx: Source) {
    if (flyChecker) return;
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
      onSelect(idx);
    }
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <div
        ref={boardRef}
        className={styles.frame}
        style={{ touchAction: "none" }}
      >
        <div className={styles.inner}>
          <div className={styles.column12}>
            <div className={styles.row6}>
              {displayTopPoints.slice(0, 6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  top
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                />
              ))}
            </div>
            <div className={styles.row6}>
              {displayBottomPoints.slice(0, 6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                />
              ))}
            </div>
          </div>

          <Bar
            state={state}
            myColor={myColor}
            selected={selected === BAR}
            isLegalFrom={legalFromPoints.includes(BAR)}
            onClick={() => handleClick(BAR)}
          />

          <div className={styles.column12}>
            <div className={styles.row6}>
              {displayTopPoints.slice(6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  top
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                />
              ))}
            </div>
            <div className={styles.row6}>
              {displayBottomPoints.slice(6).map((idx) => (
                <PointCell
                  key={idx}
                  index={idx}
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                />
              ))}
            </div>
          </div>

          <BearOff
            state={state}
            myColor={myColor}
            isLegalTarget={legalTargets.includes(OFF)}
            onClick={() =>
              legalTargets.includes(OFF) && triggerFly(selected ?? 0, OFF)
            }
          />
        </div>

        {onUndo &&
          state.turn === myColor &&
          state.moveHistory &&
          state.moveHistory.length > 0 &&
          state.phase === "moving" && <UndoButton onClick={handleUndo} />}
        {onConfirm &&
          state.phase === "moving" &&
          state.turn === myColor &&
          state.remaining.length === 0 && <ConfirmButton onClick={onConfirm} />}
      </div>

      {flyChecker && (
        <FlyingChecker
          from={{ x: flyChecker.fromX, y: flyChecker.fromY }}
          to={{ x: flyChecker.toX, y: flyChecker.toY }}
          color={flyChecker.color}
          size={flyChecker.size}
          committed={flyChecker.committed}
          onComplete={() => {
            const { to, undo } = flyChecker;
            setFlyChecker((prev) =>
              prev ? { ...prev, committed: true } : prev,
            );
            if (undo) {
              onUndo?.();
            } else if (typeof to === "number" || to === "off") {
              onMove(to);
            }
          }}
        />
      )}
    </div>
  );
}
