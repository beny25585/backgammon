import type { CSSProperties } from "react";
import { motion } from "motion/react";
import Checker from "../../Board/pieces/checker/Checker";
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
  const sizeStyle = {
    width: size,
    height: size,
    "--checker": `${size}px`,
  } as CSSProperties;

  if (committed) {
    return (
      <div
        className={styles.flyer}
        style={{ ...sizeStyle, top: to.y, left: to.x }}
        data-testid="flying-checker"
      >
        <Checker color={color} />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ x: from.x, y: from.y, scale: 1, opacity: 1 }}
      animate={{ x: to.x, y: to.y, scale: 1, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      onAnimationComplete={onComplete}
      className={styles.flyer}
      style={{ ...sizeStyle, top: 0, left: 0 }}
      data-testid="flying-checker"
    >
      <Checker color={color} />
    </motion.div>
  );
}
