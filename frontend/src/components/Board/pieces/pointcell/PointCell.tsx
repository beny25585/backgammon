import { memo } from "react";
import Checker from "../checker/Checker";
import styles from "./PointCell.module.css";
import { useBoardMaterials } from "../../materials/boardMaterialContext";

interface PointCellProps {
  index: number;
  pointNumber?: number;
  top?: boolean;
  pointValue: number;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  hideTopChecker?: boolean;
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
  hideTopChecker,
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

  const displayedCount = Math.min(count, 5);

  const renderCount = hideTopChecker ? Math.max(displayedCount - 1, 0) : displayedCount;

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

      {(selected || isLegalTarget || isLegalFrom) && (
        <div
          className={`${styles.highlight} ${isLegalTarget ? styles.pulse : ""}`}
          style={{

            background: isLegalTarget
              ? "radial-gradient(circle at 50% 50%, rgba(229, 180, 77, 0.66), transparent 68%)"
              : selected
                ? "radial-gradient(circle at 50% 50%, rgba(227, 190, 97, 0.5), transparent 70%)"
                : "radial-gradient(circle at 50% 50%, rgba(229, 180, 77, 0.3), transparent 70%)",
          }}
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

      <div data-checker-stack className={`z-3 flex items-center gap-0.5 py-2 [@container_game-layout_(height<500px)]:py-[3px] ${top ? "relative flex-col" : "absolute bottom-0 flex-col-reverse"}`}>
        {Array.from({ length: renderCount }).map((_, i) => (
          <Checker
            key={i}
            color={color!}
            label={i === 4 && count > 5 ? String(count) : undefined}
          />
        ))}
      </div>
    </button>
  );
}

export default memo(PointCell);
