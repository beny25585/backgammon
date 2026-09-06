import { memo } from "react";
import Checker from "../checker/Checker";
import styles from "./PointCell.module.css";

interface PointCellProps {
  index: number;
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
  top,
  pointValue,
  selected,
  isLegalTarget,
  isLegalFrom,
  hideTopChecker,
  onClick,
}: PointCellProps) {
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
      className={styles.point}
      style={{
        direction: "ltr",
      }}
      data-point-idx={index}
    >
      <div
        className={`${styles.background} ${
          top
            ? isLight
              ? styles.triangleLightTop
              : styles.triangleDarkTop
            : isLight
              ? styles.triangleLightBottom
              : styles.triangleDarkBottom
        }`}
      />

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

      <div className={top ? styles.checkersTop : styles.checkersBottom}>
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
