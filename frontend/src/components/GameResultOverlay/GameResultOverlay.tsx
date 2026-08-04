import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import AnimatedNumber from "../animations/AnimatedNumber/AnimatedNumber";
import styles from "./GameResultOverlay.module.css";

interface GameResultOverlayProps {
  playerColor: Color;
  winner: Color;
  winType: "single" | "gammon" | "backgammon";
  points: number;
  cube: number;
  matchScore: Record<Color, number>;
  matchTarget: number;
  matchWinner?: Color | null;
  whiteName?: string | null;
  blackName?: string | null;
  countdown?: number | null;
  onNext: () => void;
  onHome: () => void;
}

const winLabels = {
  single: "Wins!",
  gammon: "Gammon! ×2",
  backgammon: "Backgammon! ×3",
};

interface ScoreRow {
  color: Color;
  name: string;
  score: number;
  isYou: boolean;
  isWinner: boolean;
}

export default function GameResultOverlay({
  playerColor,
  winner,
  winType,
  points,
  cube,
  matchScore,
  matchTarget,
  matchWinner = null,
  whiteName = null,
  blackName = null,
  countdown,
  onNext,
  onHome,
}: GameResultOverlayProps) {
  const opponentColor = playerColor === "white" ? "black" : "white";
  const youWonGame = winner === playerColor;
  const derivedMatchWinner: Color | null =
    matchWinner ?? (matchScore[winner] >= matchTarget ? winner : null);
  const isMatchOver = derivedMatchWinner !== null;
  const youWonMatch = derivedMatchWinner === playerColor;

  const selfName = playerColor === "white" ? whiteName : blackName;
  const oppName = playerColor === "white" ? blackName : whiteName;
  const selfLabel = selfName || "You";
  const oppLabel = oppName || "Opponent";

  const selfScore = matchScore[playerColor] ?? 0;
  const oppScore = matchScore[opponentColor] ?? 0;

  // Winner's row sits on top, its score counts up from the value before this win.
  const rows: ScoreRow[] =
    winner === playerColor
      ? [
          { color: playerColor, name: selfLabel, score: selfScore, isYou: true, isWinner: true },
          { color: opponentColor, name: oppLabel, score: oppScore, isYou: false, isWinner: false },
        ]
      : [
          { color: opponentColor, name: oppLabel, score: oppScore, isYou: false, isWinner: true },
          { color: playerColor, name: selfLabel, score: selfScore, isYou: true, isWinner: false },
        ];

  function label() {
    const wl = winLabels[winType];
    return cube > 1 ? `${wl} (cube ×${cube})` : wl;
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
          className={`${styles.title} ${youWonGame || youWonMatch ? styles.titleWin : styles.titleLose}`}
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

        <div className={styles.scoreboard}>
          {rows.map((row) => (
            <div
              key={row.color}
              className={`${styles.row} ${row.isWinner ? styles.rowWin : ""}`}
              data-testid={`score-row-${row.color}`}
            >
              <span className={styles.nameWrap}>
                <span className={styles.name}>{row.name}</span>
                {row.isYou && <span className={styles.youTag}>you</span>}
              </span>
              {row.isWinner ? (
                <AnimatedNumber
                  from={Math.max(0, row.score - points)}
                  to={row.score}
                  className={`${styles.score} ${styles.scoreWin}`}
                  data-testid={`score-${row.color}`}
                />
              ) : (
                <span className={styles.score} data-testid={`score-${row.color}`}>
                  {row.score}
                </span>
              )}
            </div>
          ))}
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
            className={`${styles.button} ${isMatchOver ? styles.buttonPrimary : styles.buttonSecondary}`}
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
