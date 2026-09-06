import { motion } from "motion/react";
import styles from "./FlyingChecker.module.css";

export interface Point {
  x: number;
  y: number;
}

interface FlyingCheckerProps {
  from: Point;
  to: Point;
  color: "white" | "black";
  size: number;
  committed?: boolean;
  onComplete: () => void;
}

export default function FlyingChecker({
  from,
  to,
  color,
  size,
  committed,
  onComplete,
}: FlyingCheckerProps) {
  if (committed) {
    return (
      <div
        className={`${styles.flyer} ${color === "white" ? styles.white : styles.black}`}
        style={{ top: to.y, left: to.x, width: size, height: size }}
        data-testid="flying-checker"
      />
    );
  }
  return (
    <motion.div
      initial={{ x: from.x, y: from.y, scale: 1, opacity: 1 }}
      animate={{ x: to.x, y: to.y, scale: 1, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      onAnimationComplete={onComplete}
      className={`${styles.flyer} ${color === "white" ? styles.white : styles.black}`}
      style={{ top: 0, left: 0, width: size, height: size }}
      data-testid="flying-checker"
    />
  );
}
