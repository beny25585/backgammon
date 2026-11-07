import { memo } from "react";
import Checker from "../checker/Checker";
import styles from "./PointCell.module.css";
import { useBoardMaterials } from "../../materials/boardMaterialContext";
import { POINT_CHECKER_LIMIT, pointStackOffset, type PointStackMetrics } from "../../checkerStackGeometry";

interface PointCellProps {
  index: number;
  pointNumber?: number;
  top?: boolean;
  pointValue: number;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  playerColor?: "white" | "black" | null;
  hideTopChecker?: boolean;
  checkerLayout?: PointStackMetrics | null;
  onClick: (index: number) => void;
}

function PointCell({
  index,
  pointNumber = index + 1,
  top,
  pointValue,
  selected,
  isLegalTarget,
  isLegalFrom,
  playerColor,
  hideTopChecker,
  checkerLayout,
  onClick,
}: PointCellProps) {
  const { ready: materialReady } = useBoardMaterials();
  const isLight = index % 2 === 0;

  const count = Math.abs(pointValue);

  const color: "white" | "black" | null =
    pointValue > 0
      ? "white"
      : pointValue < 0
        ? "black"
        : null;

  const displayedCount = Math.min(count, POINT_CHECKER_LIMIT);

  const renderCount = hideTopChecker ? Math.max(displayedCount - 1, 0) : displayedCount;
  const targetStackCount = color === playerColor ? count : 0;
  const targetSlot = Math.min(targetStackCount, POINT_CHECKER_LIMIT - 1);

  return (
    <button
      onClick={() => onClick(index)}
      className={`${styles.point} group min-h-0 min-w-0`}
      style={{
        direction: "ltr",
      }}
      data-point-idx={index}
      data-point-top={top ? "true" : "false"}
      data-point-light={isLight ? "true" : "false"}
      data-legal-from={isLegalFrom}
      data-legal-target={isLegalTarget}
    >
      <div
        aria-hidden="true"
        data-point-material="triangle"
        className={`${styles.background} ${materialReady ? "invisible" : ""} ${
          top
            ? isLight
              ? styles.triangleLightTop
              : styles.triangleDarkTop
            : isLight
              ? styles.triangleLightBottom
              : styles.triangleDarkBottom
        }`}
      />

      <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-2 rounded-sm group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-amber-200" />

      {isLegalFrom && !selected && (
        <span
          aria-hidden="true"
          data-legal-source-marker
          className={`pointer-events-none absolute inset-x-[14%] z-2 h-[clamp(3px,0.52cqw,5px)] rounded-full bg-amber-100 shadow-[0_0_0_1px_#332216,0_1px_3px_#000b] ${top ? "top-0" : "bottom-0"}`}
        />
      )}
      {isLegalTarget && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 z-4 -translate-x-1/2 rounded-full border-2 border-amber-100/90 bg-amber-200/15 shadow-[0_0_0_1px_#21160de0] motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:starting:opacity-0 ${checkerLayout ? "" : `size-[min(var(--checker),90%)] ${top ? "top-2" : "bottom-2"}`}`}
          style={checkerLayout ? {
            width: checkerLayout.diameter,
            height: checkerLayout.diameter,
            top: pointStackOffset(checkerLayout, targetStackCount + 1, targetSlot, Boolean(top)),
          } : undefined}
        />
      )}

      <span
        className={`pointer-events-none absolute left-1/2 z-20 grid h-[var(--board-number-rim,20px)] -translate-x-1/2 place-items-center select-none text-[length:min(clamp(11px,1.65cqw,20px),calc(var(--board-number-rim,20px)_-_4px))] leading-none font-semibold tabular-nums text-[var(--board-number-color,#ead3a2)] @max-[620px]/game-layout:text-xs ${materialReady ? "[text-shadow:-0.5px_-0.5px_0_#fff5d733,0_1px_1px_#000000dd]" : "[text-shadow:0_1px_2px_#000000]"} ${
          top ? "top-[calc(-1*var(--board-number-rim,20px))]" : "bottom-[calc(-1*var(--board-number-rim,20px))]"
        }`}
        data-testid="point-number"
      >
        {pointNumber}
      </span>

      <div data-checker-stack className={`absolute inset-0 z-3 flex items-center gap-0.5 py-2 [@container_game-layout_(height<500px)]:py-[3px] ${top ? "flex-col" : "flex-col-reverse"}`}>
        {Array.from({ length: renderCount }).map((_, i) => (
          <div
            key={i}
            data-checker-slot={i}
            className={checkerLayout ? "absolute left-1/2 -translate-x-1/2" : "shrink-0"}
            style={checkerLayout ? { top: pointStackOffset(checkerLayout, displayedCount, i, Boolean(top)) } : undefined}
          >
            <Checker
              color={color!}
              size={checkerLayout?.diameter}
              selected={selected && !hideTopChecker && i === renderCount - 1}
              label={i === POINT_CHECKER_LIMIT - 1 && count > POINT_CHECKER_LIMIT ? String(count) : undefined}
            />
          </div>
        ))}
      </div>
    </button>
  );
}

export default memo(PointCell);
