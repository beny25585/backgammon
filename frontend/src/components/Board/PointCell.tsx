import { motion } from "motion/react";
import type { GameState } from "@/lib/backgammon/engine";
import { Checker } from "./Checker";
import styles from "./PointCell.module.css";

export function PointCell({
  index,
  top,
  state,
  selected,
  isLegalTarget,
  isLegalFrom,
  onClick,
}: {
  index: number;
  top?: boolean;
  state: GameState;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
}) {
  const isLight = index % 2 === 0;
  const count = Math.abs(state.points[index]);
  const color: "white" | "black" | null =
    state.points[index] > 0 ? "white" : state.points[index] < 0 ? "black" : null;

  const triangleClass = top
    ? isLight
      ? styles.triangleLightTop
      : styles.triangleDarkTop
    : isLight
      ? styles.triangleLightBottom
      : styles.triangleDarkBottom;

  const glowClass = isLegalTarget
    ? styles.glowLegal
    : selected
      ? styles.glowSelected
      : styles.glowFrom;

  return (
    <motion.button
      whileHover={isLegalFrom || isLegalTarget ? { y: -2 } : undefined}
      onClick={onClick}
      className={`${styles.cell} focus:outline-none group`}
      style={{ direction: "ltr" }}
    >
      <div className={`absolute inset-0 ${triangleClass}`} />
      {(selected || isLegalTarget || isLegalFrom) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`absolute inset-0 pointer-events-none ${isLegalTarget ? "animate-pulse-glow" : ""} ${glowClass}`}
        />
      )}
      <div className={top ? styles.checkersTop : styles.checkersBottom}>
        {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
          <Checker key={i} color={color!} label={i === 4 && count > 5 ? String(count) : undefined} />
        ))}
      </div>
    </motion.button>
  );
}
