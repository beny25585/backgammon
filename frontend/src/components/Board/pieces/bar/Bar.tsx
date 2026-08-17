import type { GameState, Color } from "@/lib/backgammon/engine";
import Checker from "../checker/Checker";
import styles from "./Bar.module.css";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  hideChecker?: "white" | "black" | null;
  onClick: () => void;
}

export default function Bar({
  state,
  selected,
  isLegalFrom,
  hideChecker,
  onClick,
}: BarProps) {
  return (
    <button onClick={onClick} className={styles.bar} data-point-idx="bar">
      {(selected || isLegalFrom) && <div className={styles.highlight} />}

      <div className={styles.checkers}>
        {Array.from({
          length: Math.max(state.bar.black - (hideChecker === "black" ? 1 : 0), 0),
        }).map((_, i) => (
          <Checker key={i} color="black" />
        ))}
      </div>

      <div className={styles.checkers}>
        {Array.from({
          length: Math.max(state.bar.white - (hideChecker === "white" ? 1 : 0), 0),
        }).map((_, i) => (
          <Checker key={i} color="white" />
        ))}
      </div>
    </button>
  );
}
