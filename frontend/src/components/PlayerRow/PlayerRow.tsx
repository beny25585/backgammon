import styles from "./PlayerRow.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface PlayerRowProps {
  color: Color;
  state: GameState;
  label: string;
  active: boolean;
  self: boolean;
  score?: number;
}

export default function PlayerRow({ color, state, label, active, self, score }: PlayerRowProps) {
  const checkersOff = color === "white" ? state.home.white : state.home.black;
  const checkersOnBar = color === "white" ? state.bar.white : state.bar.black;

  return (
    <div className={`${styles.row} ${active ? (self ? styles.activeSelf : styles.activeOpponent) : styles.idle}`}>
      <span className={`${styles.avatar} ${styles[color]}`} />
      <div className={styles.info}>
        <span className={styles.name} data-testid={`player-name-${color}`}>{label}</span>
        <div className={styles.chips}>
          <span className={styles.chip}>Off {checkersOff}</span>
          {checkersOnBar > 0 && <span className={styles.chip}>Bar {checkersOnBar}</span>}
        </div>
      </div>
      <div className={styles.scoreWrap}>
        {active && <span className={styles.turnBadge}>{self ? "Your Turn" : "Their Turn"}</span>}
        <span className={styles.score} data-testid={`player-score-${color}`}>{score}</span>
      </div>
    </div>
  );
}
