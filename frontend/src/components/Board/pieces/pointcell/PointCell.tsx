import { motion } from "motion/react";
import type { GameState, Source, Target } from "@/lib/backgammon/engine";
import Checker from "../checker/Checker";
import styles from "./PointCell.module.css";

interface PointCellProps {
  index: number;
  top?: boolean;
  state: GameState;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  lastMoveFrom: Source | null;
  lastMoveTo: Target | null;
  instantTarget?: Source | null;
  hideTopChecker?: boolean;
  onClick: () => void;
}

export default function PointCell({
  index,
  top,
  state,
  selected,
  isLegalTarget,
  isLegalFrom,
  lastMoveTo,
  instantTarget,
  hideTopChecker,
  onClick,
}: PointCellProps) {
  const isLight = index % 2 === 0;

  const count = Math.abs(state.points[index]);

  const color: "white" | "black" | null =
    state.points[index] > 0
      ? "white"
      : state.points[index] < 0
        ? "black"
        : null;

  const isMoveTarget = lastMoveTo === index || instantTarget === index;

  const displayedCount = Math.min(count, 5);

  const renderCount = hideTopChecker ? Math.max(displayedCount - 1, 0) : displayedCount;

  const newCheckerIndex = isMoveTarget ? renderCount - 1 : -1;

  return (
    <motion.button
      whileHover={isLegalFrom || isLegalTarget ? { y: -2 } : undefined}
      onClick={onClick}
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
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
            instant={i === newCheckerIndex}
            label={i === 4 && count > 5 ? String(count) : undefined}
          />
        ))}
      </div>
    </motion.button>
  );
}
