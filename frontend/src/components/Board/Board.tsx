import { motion } from "motion/react";
import { useMemo, useRef, useState, useCallback } from "react";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import { BAR, OFF } from "@/lib/backgammon/engine";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import PointCell from "./pieces/pointcell/PointCell";
import Bar from "./pieces/bar/Bar";
import BearOff from "./pieces/bearoff/BearOff";
import styles from "../GameScreen/GameScreen.module.css";
import {
  TOP_POINTS,
  BOTTOM_POINTS,
} from "./layout";

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
    fromX: number; fromY: number;
    toX: number; toY: number;
    color: Color;
    size: number;
  } | null>(null);

  const lastMoveLast = useMemo(() => {
    const lm = state.lastMove;
    return lm && lm.length > 0 ? lm[lm.length - 1] : null;
  }, [state.lastMove]);

  const triggerFly = useCallback(
    (from: Source, to: Target) => {
      const board = boardRef.current;
      if (!board) { onMove(to); return; }
      const fromEl = board.querySelector<HTMLElement>(`[data-point-idx="${from}"]`);
      const toEl = board.querySelector<HTMLElement>(`[data-point-idx="${to}"]`);
      if (!fromEl || !toEl) { onMove(to); return; }

      const bRect = board.getBoundingClientRect();
      const fRect = fromEl.getBoundingClientRect();
      const tRect = toEl.getBoundingClientRect();
      const checkerPx = getCheckerSize(board);

      setFlyChecker({
        fromX: fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2,
        fromY: fRect.top + fRect.height / 2 - bRect.top - checkerPx / 2,
        toX: tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2,
        toY: tRect.top + tRect.height / 2 - bRect.top - checkerPx / 2,
        color: myColor ?? "white",
        size: checkerPx,
      });

      setTimeout(() => { setFlyChecker(null); onMove(to); }, 320);
    },
    [myColor, onMove],
  );

  function handleClick(idx: Source) {
    if (flyChecker) return;
    if (typeof idx === "number" && legalTargets.includes(idx)) {
      if (selected !== null) { triggerFly(selected, idx); return; }
      onMove(idx);
      return;
    }
    if (selected === idx) {
      if (legalTargets.length === 1) { triggerFly(selected, legalTargets[0]); }
      else { onSelect(null); }
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
              {TOP_POINTS.slice(0, 6).map((idx) => (
                <PointCell key={idx} index={idx} top state={state}
                  selected={selected === idx} isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null} />
              ))}
            </div>
            <div className={styles.row6}>
              {BOTTOM_POINTS.slice(0, 6).map((idx) => (
                <PointCell key={idx} index={idx} state={state}
                  selected={selected === idx} isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null} />
              ))}
            </div>
          </div>

          <Bar state={state} myColor={myColor} selected={selected === BAR}
            isLegalFrom={legalFromPoints.includes(BAR)} onClick={() => handleClick(BAR)} />

          <div className={styles.column12}>
            <div className={styles.row6}>
              {TOP_POINTS.slice(6).map((idx) => (
                <PointCell key={idx} index={idx} top state={state}
                  selected={selected === idx} isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null} />
              ))}
            </div>
            <div className={styles.row6}>
              {BOTTOM_POINTS.slice(6).map((idx) => (
                <PointCell key={idx} index={idx} state={state}
                  selected={selected === idx} isLegalTarget={legalTargets.includes(idx)}
                  isLegalFrom={legalFromPoints.includes(idx)}
                  onClick={() => handleClick(idx)}
                  lastMoveFrom={lastMoveLast?.from ?? null}
                  lastMoveTo={lastMoveLast?.to ?? null} />
              ))}
            </div>
          </div>

          <BearOff state={state} myColor={myColor} isLegalTarget={legalTargets.includes(OFF)}
            onClick={() => legalTargets.includes(OFF) && triggerFly(selected ?? 0, OFF)} />
        </div>

        {onUndo && state.moveHistory && state.moveHistory.length > 0 && state.phase === "moving" && (
          <UndoButton onClick={onUndo} />
        )}
        {onConfirm && state.phase === "moving" && state.turn === myColor && state.remaining.length === 0 && (
          <ConfirmButton onClick={onConfirm} />
        )}
      </div>

      {flyChecker && (
        <motion.div
          initial={{ x: flyChecker.fromX, y: flyChecker.fromY, scale: 1, opacity: 1 }}
          animate={{ x: flyChecker.toX, y: flyChecker.toY, scale: 0.85, opacity: 0.9 }}
          transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          className={styles.flyer}
          style={{
            top: 0, left: 0,
            width: flyChecker.size + "px",
            height: flyChecker.size + "px",
            background: flyChecker.color === "white"
              ? "radial-gradient(circle at 30% 25%, #ffffff, #f4e4c1 55%, #b89660 100%)"
              : "radial-gradient(circle at 30% 25%, #6a4830, #2a1810 55%, #0a0402 100%)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.7), inset 0 -3px 4px rgba(0,0,0,0.35), inset 0 2px 2px rgba(255,255,255,0.15), 0 0 24px rgba(201,169,97,0.5)",
            border: flyChecker.color === "white" ? "1px solid #c9a961" : "1px solid #000",
          }}
        />
      )}
    </div>
  );
}
