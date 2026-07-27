import type { GameState, Color } from "@/lib/backgammon/engine";
import Checker from "../checker/Checker";
import styles from "./Bar.module.css";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
}

export default function Bar({
  state,
  selected,
  isLegalFrom,
  onClick,
}: BarProps) {
  return (
    <button onClick={onClick} className={styles.bar} data-point-idx="bar">
      {(selected || isLegalFrom) && <div className={styles.highlight} />}

      <div className={styles.checkers}>
        {Array.from({ length: state.bar.black }).map((_, i) => (
          <Checker key={i} color="black" />
        ))}
      </div>

      <div className={styles.checkers}>
        {Array.from({ length: state.bar.white }).map((_, i) => (
          <Checker key={i} color="white" />
        ))}
      </div>
    </button>
  );
}
