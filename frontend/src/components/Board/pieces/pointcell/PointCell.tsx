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

  const isMoveTarget = lastMoveTo === index;

  const displayedCount = Math.min(count, 5);

  const newCheckerIndex = isMoveTarget ? displayedCount - 1 : -1;

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
        className={styles.background}
        style={{
          background: isLight
            ? `linear-gradient(
                ${top ? "180deg" : "0deg"},
                #e8bf87 0%,
                #b98548 100%
              )`
            : `linear-gradient(
                ${top ? "180deg" : "0deg"},
                #4a2f1a 0%,
                #1a0e06 100%
              )`,

          clipPath: top
            ? "polygon(0 0, 100% 0, 50% 100%)"
            : "polygon(50% 0, 100% 100%, 0 100%)",
        }}
      />

      {(selected || isLegalTarget || isLegalFrom) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`${styles.highlight} ${isLegalTarget ? styles.pulse : ""}`}
          style={{
            background: isLegalTarget
              ? "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.55), transparent 70%)"
              : selected
                ? "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.75), transparent 70%)"
                : "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.2), transparent 70%)",
          }}
        />
      )}

      <div className={top ? styles.checkersTop : styles.checkersBottom}>
        {Array.from({ length: displayedCount }).map((_, i) => (
          <Checker
            key={i}
            color={color!}
            flyIn={i === newCheckerIndex}
            label={i === 4 && count > 5 ? String(count) : undefined}
          />
        ))}
      </div>
    </motion.button>
  );
}
