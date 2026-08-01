import styles from "./PlayerRow.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface PlayerRowProps {
  color: Color;
  state: GameState;
  label: string;
  active: boolean;
  self: boolean;
}

export default function PlayerRow({ color, state, label, active, self }: PlayerRowProps) {
  const checkersOff = color === "white" ? state.home.white : state.home.black;
  const checkersOnBar = color === "white" ? state.bar.white : state.bar.black;

  const whiteScore = (state as unknown as Record<string, unknown>)?.whiteScore ?? (state as unknown as Record<string, unknown>)?.white_score ?? 0;
  const blackScore = (state as unknown as Record<string, unknown>)?.blackScore ?? (state as unknown as Record<string, unknown>)?.black_score ?? 0;
  const rawScore = color === "white" ? whiteScore : blackScore;
  const score = typeof rawScore === "number" ? rawScore : 0;

  return (
    <div className={`${styles.row} ${active ? (self ? styles.activeSelf : styles.activeOpponent) : styles.idle}`}>
      <span className={`${styles.avatar} ${styles[color]}`} />
      <div className={styles.info}>
        <span className={styles.name}>{label}</span>
        <div className={styles.chips}>
          <span className={styles.chip}>Off {checkersOff}</span>
          {checkersOnBar > 0 && <span className={styles.chip}>Bar {checkersOnBar}</span>}
        </div>
      </div>
      <div className={styles.scoreWrap}>
        {active && <span className={styles.turnBadge}>{self ? "Your Turn" : "Their Turn"}</span>}
        <span className={styles.score}>{score}</span>
      </div>
    </div>
  );
}
