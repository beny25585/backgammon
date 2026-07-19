import styles from "./TurnIndicator.module.css";
import type { Color } from "@/lib/backgammon/engine";

interface TurnIndicatorProps {
  currentTurn: Color;
  playerColor: Color;
}

export default function TurnIndicator({
  currentTurn,
  playerColor,
}: TurnIndicatorProps) {
  const isPlayerTurn = currentTurn === playerColor;

  return (
    <div
      className={`${styles.turnIndicator} ${isPlayerTurn ? styles.active : styles.inactive}`}
    >
      <div className={styles.indicator}>
        <span className={`${styles.dot} ${styles[currentTurn]}`} />
        {isPlayerTurn ? (
          <span className={styles.text}>YOUR TURN</span>
        ) : (
          <span className={styles.text}>OPPONENT'S TURN</span>
        )}
      </div>
    </div>
  );
}
