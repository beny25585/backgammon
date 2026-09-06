import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import {
  BAR,
  OFF,
  canOfferDouble,
  legalMovesFrom,
  type Move,
} from "@/lib/backgammon/engine";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import PointCell from "./pieces/pointcell/PointCell";
import Bar from "./pieces/bar/Bar";
import BearOff from "./pieces/bearoff/BearOff";
import FlyingChecker from "../animations/FlyingChecker/FlyingChecker";
import DoublingCube from "../DoublingCube";
import styles from "../GameScreen/GameScreen.module.css";
import { TOP_POINTS, BOTTOM_POINTS } from "./layout";
import { useI18n } from "../../i18n/I18nProvider";

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
  onRoll?: () => void;
  onOfferDouble?: () => void;
  autoMove?: Move | null;
}

function getCheckerSize(board: HTMLElement): number {
  const checkerEl = board.querySelector<HTMLElement>("[data-checker]");
  if (!checkerEl) return 30;
  return checkerEl.getBoundingClientRect().width;
}

function preferredDirectMove(moves: Move[], remaining: number[]): Move | null {
  if (moves.length === 0) return null;
  for (const die of remaining) {
    const move = moves.find((m) => m.die === die);
    if (move) return move;
  }
  return [...moves].sort((a, b) => b.die - a.die)[0];
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
}: BoardProps) {
  const { t } = useI18n();
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [flyChecker, setFlyChecker] = useState<{
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
    pending:
      | { kind: "move"; historyLen: number }
      | { kind: "undo"; historyLen: number };
  } | null>(null);

  const [undoLanding, setUndoLanding] = useState<Source | null>(null);

  const knownLastMoveRef = useRef<
    { from: Source | Target; to: Target }[] | null
  >(null);
  const humanMoveRef = useRef<{ from: Source | Target; to: Target } | null>(
    null,
  );

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
    const t = setTimeout(() => setFlyChecker(null), 600);
    return () => clearTimeout(t);
  }, [flyChecker?.committed]);

  const lastMoveLast = useMemo(() => {
    const lm = state.lastMove;
    return lm && lm.length > 0 ? lm[lm.length - 1] : null;
  }, [state.lastMove]);

  const displayTopPoints = myColor === "black" ? BOTTOM_POINTS : TOP_POINTS;

  const displayBottomPoints = myColor === "black" ? TOP_POINTS : BOTTOM_POINTS;

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
    (from: Source, to: Target) => {
      humanMoveRef.current = { from, to };
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
        typeof from === "number"
          ? Math.abs(state.points[from] ?? 0)
          : Math.abs(state.bar[myColor ?? "white"] ?? 0);
      const fromStackIndex = Math.min(Math.max(fromCount - 1, 0), 4);
      const isFromTop =
        typeof from === "number" && displayTopPoints.includes(from);

      // The checker lands on TOP of the destination stack (count + 1).
      const toCount =
        typeof to === "number" ? Math.abs(state.points[to] ?? 0) : 0;
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
        fromX,
        fromY,
        toX,
        toY,
        from,
        fromCount,
        color: myColor ?? "white",
        size: checkerPx,
        to,
        committed: false,
        pending: { kind: "move", historyLen: state.moveHistory?.length ?? 0 },
      });
    },
    [
      myColor,
      onMove,
      state.points,
      displayTopPoints,
      computeSlotY,
    ],
  );

  const animateExternalMove = useCallback(
    (from: Source | Target, to: Target, mover: Color) => {
      const board = boardRef.current;
      if (!board) return;
      const fromEl = board.querySelector<HTMLElement>(
        `[data-point-idx="${from}"]`,
      );
      const toEl = board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`);
      if (!fromEl || !toEl) return;

      const bRect = board.getBoundingClientRect();
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
        pending: { kind: "move", historyLen: state.moveHistory?.length ?? 0 },
      });
    },
    [
      state.points,
      state.bar,
      state.moveHistory,
      displayTopPoints,
      computeSlotY,
    ],
  );

  useEffect(() => {
    const lm = state.lastMove;
    const known = knownLastMoveRef.current;
    if (lm === null) {
      knownLastMoveRef.current = null;
      return;
    }
    if (known === null || lm.length <= known.length) {
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
    if (flyChecker) return;
    const mover: Color = myColor === "black" ? "white" : "black";
    animateExternalMove(last.from, last.to, mover);
  }, [state.lastMove, flyChecker, myColor, animateExternalMove]);

  useEffect(() => {
    if (!autoMove) return;
    if (flyChecker) return;
    triggerFly(autoMove.from, autoMove.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMove]);

  const handleUndo = useCallback(() => {
    if (flyChecker) return;
    const board = boardRef.current;
    const last = lastMoveLast;
    if (!board || !last) {
      onUndo?.();
      return;
    }
    const toEl = board.querySelector<HTMLElement>(
      `[data-point-idx="${last.to}"]`,
    );
    const fromEl = board.querySelector<HTMLElement>(
      `[data-point-idx="${last.from}"]`,
    );
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
      typeof last.to === "number"
        ? Math.abs(state.points[last.to] ?? 0)
        : Math.abs(state.bar[myColor ?? "white"] ?? 0);
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
      pending: { kind: "undo", historyLen: state.moveHistory?.length ?? 0 },
    });
    setUndoLanding(last.from);
  }, [
    myColor,
    onUndo,
    state.points,
    displayTopPoints,
    computeSlotY,
    lastMoveLast,
    flyChecker,
  ]);

  function hideTopCheckerAt(idx: number) {
    if (!flyChecker) return false;
    if (flyChecker.external) return flyChecker.to === idx;
    return (
      flyChecker.from === idx &&
      Math.abs(state.points[idx] ?? 0) === flyChecker.fromCount
    );
  }

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
  }

  const canUndo =
    Boolean(onUndo) &&
    state.turn === myColor &&
    Boolean(state.moveHistory?.length) &&
    state.phase === "moving";
  const canConfirm =
    Boolean(onConfirm) &&
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
    <div ref={wrapperRef} className={styles.wrapper} dir="ltr">
      <div
        ref={boardRef}
        className={styles.frame}
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
                  top
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                  hideTopChecker={hideTopCheckerAt(idx)}
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
                  hideTopChecker={hideTopCheckerAt(idx)}
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
            hideChecker={
              flyChecker &&
              flyChecker.from === BAR &&
              Math.abs(state.bar[flyChecker.color] ?? 0) ===
                flyChecker.fromCount
                ? flyChecker.color
                : null
            }
            doublingCube={
              <DoublingCube
                value={state.cube}
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
                  top
                  state={state}
                  selected={selected === idx}
                  isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null}
                  instantTarget={undoLanding}
                  hideTopChecker={hideTopCheckerAt(idx)}
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
                  hideTopChecker={hideTopCheckerAt(idx)}
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

        {canUndo && (
          <div className={styles.boardUndoAction}>
            <UndoButton onClick={handleUndo} />
          </div>
        )}
        {canConfirm && (
          <div className={styles.boardConfirmAction}>
            <ConfirmButton onClick={onConfirm} />
          </div>
        )}
        {canRoll && (
          <div className={styles.boardDoubleAction}>
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

      {flyChecker && (
        <FlyingChecker
          from={{ x: flyChecker.fromX, y: flyChecker.fromY }}
          to={{ x: flyChecker.toX, y: flyChecker.toY }}
          color={flyChecker.color}
          size={flyChecker.size}
          committed={flyChecker.committed}
          onComplete={() => {
            if (flyChecker.external) {
              setFlyChecker(null);
              return;
            }
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
