import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
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
  toSize?: number;
  committed?: boolean;
  captured?: boolean;
  onComplete: () => void;
}

export default function FlyingChecker({
  from,
  to,
  color,
  size,
  toSize = size,
  committed,
  captured = false,
  onComplete,
}: FlyingCheckerProps) {
  const reduceMotion = useReducedMotion();
  const testId = captured ? "captured-checker-flight" : "flying-checker";
  const sizeStyle = {
    width: size,
    height: size,
    "--checker": "100%",
    "--checker-height-limit": "100vmax",
  } as CSSProperties;
  const fromTransform = `translate(${from.x}px, ${from.y}px) scale(1)`;
  const endScale = size > 0 ? toSize / size : 1;
  const settleScale = (1 + (endScale - 1) * 0.88) * 1.03;
  const settle = `translate(${from.x + (to.x - from.x) * 0.88}px, ${from.y + (to.y - from.y) * 0.88 - 2}px) scale(${settleScale})`;
  const arrival = `translate(${to.x}px, ${to.y}px) scale(${endScale})`;

  if (committed) {
    return (
      <div
        className={styles.flyer}
        style={{ ...sizeStyle, width: toSize, height: toSize, top: to.y, left: to.x }}
        data-testid={testId}
        data-capture-phase={captured ? "waiting" : undefined}
      >
        <Checker color={color} />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ transform: fromTransform }}
      animate={{ transform: reduceMotion ? arrival : [fromTransform, settle, arrival] }}
      transition={{ duration: reduceMotion ? 0 : 0.18, times: [0, 0.78, 1], ease: [0.23, 1, 0.32, 1] }}
      onAnimationComplete={onComplete}
      className={styles.flyer}
      style={{ ...sizeStyle, top: 0, left: 0, transformOrigin: "top left" }}
      data-testid={testId}
      data-capture-phase={captured ? "flying" : undefined}
    >
      <Checker color={color} />
    </motion.div>
  );
}
