import type { GameState, Color } from "@/lib/backgammon/engine";
import { pipCount } from "@/lib/backgammon/engine";
import type { ReactNode } from "react";
import Checker from "../checker/Checker";
import styles from "./Bar.module.css";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  hideChecker?: "white" | "black" | null;
  doublingCube?: ReactNode;
  cubePosition?: "top" | "center" | "bottom";
  onClick: () => void;
}

export default function Bar({
  state,
  selected,
  isLegalFrom,
  hideChecker,
  doublingCube,
  cubePosition = "center",
  onClick,
}: BarProps) {
  return (
    <button type="button" onClick={onClick} className={styles.bar} data-point-idx="bar">
      {(selected || isLegalFrom) && <div className={styles.highlight} />}

      <span className={`${styles.pipCount} ${styles.topPip}`}>
        {pipCount(state, "black")}
      </span>

      {doublingCube && (
        <div
          className={styles.cubeSlot}
          data-cube-position={cubePosition}
          data-testid="bar-doubling-cube"
        >
          {doublingCube}
        </div>
      )}

      <div className={`${styles.checkers} ${styles.topCheckers}`}>
        {Array.from({
          length: Math.max(state.bar.black - (hideChecker === "black" ? 1 : 0), 0),
        }).map((_, i) => (
          <Checker key={i} color="black" />
        ))}
      </div>

      <div className={`${styles.checkers} ${styles.bottomCheckers}`}>
        {Array.from({
          length: Math.max(state.bar.white - (hideChecker === "white" ? 1 : 0), 0),
        }).map((_, i) => (
          <Checker key={i} color="white" />
        ))}
      </div>

      <span className={`${styles.pipCount} ${styles.bottomPip}`}>
        {pipCount(state, "white")}
      </span>
    </button>
  );
}
