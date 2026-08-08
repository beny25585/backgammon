import { useMemo, useRef, useState, useCallback } from "react";
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
import { clientLogger } from "@/services/logger";

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
    to: Target;
  } | null>(null);

  const lastMoveLast = useMemo(() => {
    const lm = state.lastMove;
    return lm && lm.length > 0 ? lm[lm.length - 1] : null;
  }, [state.lastMove]);

  const displayTopPoints = myColor === "black" ? BOTTOM_POINTS : TOP_POINTS;

  const displayBottomPoints = myColor === "black" ? TOP_POINTS : BOTTOM_POINTS;

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

      setFlyChecker({
        fromX: fRect.left + fRect.width / 2 - bRect.left - checkerPx / 2,
        fromY: fRect.top + fRect.height / 2 - bRect.top - checkerPx / 2,
        toX: tRect.left + tRect.width / 2 - bRect.left - checkerPx / 2,
        toY: tRect.top + tRect.height / 2 - bRect.top - checkerPx / 2,
        color: myColor ?? "white",
        size: checkerPx,
        to,
      });
    },
    [myColor, onMove],
  );

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
          state.moveHistory &&
          state.moveHistory.length > 0 &&
          state.phase === "moving" && <UndoButton onClick={onUndo} />}
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
          onComplete={() => {
            setFlyChecker(null);
            onMove(flyChecker.to);
          }}
        />
      )}
    </div>
  );
}
