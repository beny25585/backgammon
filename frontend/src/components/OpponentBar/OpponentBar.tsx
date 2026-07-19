import styles from "./OpponentBar.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface OpponentBarProps {
  color: Color;
  state: GameState;
}

export default function OpponentBar({ color, state }: OpponentBarProps) {
  const checkersOff = color === "white" ? state.home.white : state.home.black;
  const checkersOnBar = color === "white" ? state.bar.white : state.bar.black;

  const whiteScore = (state as unknown as Record<string, unknown>)?.whiteScore ?? (state as unknown as Record<string, unknown>)?.white_score ?? 0;
  const blackScore = (state as unknown as Record<string, unknown>)?.blackScore ?? (state as unknown as Record<string, unknown>)?.black_score ?? 0;
  const targetPoints = (state as unknown as Record<string, unknown>)?.targetPoints ?? (state as unknown as Record<string, unknown>)?.target_points ?? 7;

  const scoreWhite = typeof whiteScore === "number" ? whiteScore : 0;
  const scoreBlack = typeof blackScore === "number" ? blackScore : 0;
  const target = typeof targetPoints === "number" ? targetPoints : 7;

  return (
    <div className={`${styles.opponentBar} ${styles[color]}`}>
      <div className={styles.playerInfo}>
        <h2 className={styles.playerName}>{color.toUpperCase()} PLAYER</h2>
        <p className={styles.status}>
          {state.phase === "game_over" && state.winner === color ? (
            <span className={styles.winner}>WINNER</span>
          ) : (
            <>
              <span className={styles.stat}>Off: {checkersOff}/15</span>
              {checkersOnBar > 0 && (
                <span className={styles.stat}>Bar: {checkersOnBar}</span>
              )}
            </>
          )}
        </p>
      </div>

      <div className={styles.scoreSection}>
        <span className={styles.score}>
          {color === "white" ? scoreWhite : scoreBlack} - {color === "white" ? scoreBlack : scoreWhite}
        </span>
        <span className={styles.target}>First to {target}</span>
      </div>

      <div className={styles.checkerPreview}>
        {Array.from({ length: Math.min(checkersOff, 5) }).map((_, i) => (
          <div key={i} className={`${styles.checkerIcon} ${styles[color]}`} />
        ))}
        {checkersOff > 5 && (
          <span className={styles.more}>+{checkersOff - 5}</span>
        )}
      </div>
    </div>
  );
}
