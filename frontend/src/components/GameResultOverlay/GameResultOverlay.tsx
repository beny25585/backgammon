import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./GameResultOverlay.module.css";

interface GameResultOverlayProps {
  playerColor: Color;
  winner: Color;
  winType: "single" | "gammon" | "backgammon";
  points: number;
  cube: number;
  matchScore: Record<Color, number>;
  matchTarget: number;
  matchWinner: Color | null;
  countdown?: number | null;
  onNext: () => void;
  onHome: () => void;
}

const winLabels = {
  single: "Wins!",
  gammon: "Gammon! ×2",
  backgammon: "Backgammon! ×3",
};

export default function GameResultOverlay({
  playerColor,
  winner,
  winType,
  points,
  cube,
  matchScore,
  matchTarget,
  matchWinner,
  countdown,
  onNext,
  onHome,
}: GameResultOverlayProps) {
  const isMatchOver = matchWinner !== null;
  const opponentColor = playerColor === "white" ? "black" : "white";
  const youWonGame = winner === playerColor;
  const youWonMatch = isMatchOver && matchWinner === playerColor;

  function label() {
    const wl = winLabels[winType];
    if (cube > 1) return `${wl} (cube ×${cube}) → +${points}`;
    return `${wl} → +${points}`;
  }

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={styles.card}
        initial={{ scale: 0.8, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
      >
        {isMatchOver && (
          <span className={styles.emoji} role="img" aria-hidden="true">
            {youWonMatch ? "🏆" : "😞"}
          </span>
        )}

        <h2
          className={`${styles.title} ${youWonGame ? styles.titleWin : styles.titleLose}`}
        >
          {isMatchOver
            ? youWonMatch
              ? "Match Won!"
              : "Match Lost"
            : youWonGame
              ? "You Win!"
              : "You Lost"}
        </h2>

        <p className={styles.subtitle}>{label()}</p>

        <div className={styles.scorePanel}>
          <p className={styles.scoreLabel}>
            Match Score (first to {matchTarget})
          </p>
          <div className={styles.scoreRow}>
            <span className={styles.scoreYou}>
              You: {matchScore[playerColor]}
            </span>
            <span className={styles.scoreVs}>vs</span>
            <span
              className={
                matchWinner === opponentColor
                  ? styles.scoreBotWin
                  : styles.scoreBot
              }
            >
              Bot: {matchScore[opponentColor]}
            </span>
          </div>
        </div>

        <div className={styles.buttonRow}>
          {!isMatchOver && (
            <button
              onClick={onNext}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              Next Game →
            </button>
          )}
          <button
            onClick={onHome}
            className={`${styles.button} ${styles.buttonSecondary}`}
          >
            {isMatchOver ? "Back to Home" : "Quit Match"}
          </button>
        </div>

        {!isMatchOver && countdown != null && matchTarget > 1 && (
          <p className={styles.autoNote}>
            Next game starts automatically in {countdown}s
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
