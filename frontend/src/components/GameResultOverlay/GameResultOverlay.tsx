import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import AnimatedNumber from "../animations/AnimatedNumber/AnimatedNumber";
import { useI18n } from "../../i18n/I18nProvider";
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
  matchOver?: boolean;
  reason?: string;
  whiteName?: string | null;
  blackName?: string | null;
  countdown?: number | null;
  onNext: () => void;
  onHome: () => void;
  homeLabel?: string;
}

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
  matchOver,
  reason,
  whiteName = null,
  blackName = null,
  countdown,
  onNext,
  onHome,
  homeLabel,
}: GameResultOverlayProps) {
  const { t } = useI18n();
  const opponentColor = playerColor === "white" ? "black" : "white";
  const youWonGame = winner === playerColor;
  // The server marks the match as over when the room is closed (target
  // reached, or the opponent left/forfeited). Fall back to the score-vs-target
  // heuristic only for callers that don't report `matchOver` (local games).
  const derivedMatchWinner: Color | null =
    matchWinner ??
    (matchOver === true || matchScore[winner] >= matchTarget ? winner : null);
  const isMatchOver = derivedMatchWinner !== null;
  const youWonMatch = derivedMatchWinner === playerColor;

  const selfName = playerColor === "white" ? whiteName : blackName;
  const oppName = playerColor === "white" ? blackName : whiteName;
  const selfLabel = selfName || t("common.you");
  const oppLabel = oppName || t("common.opponent");
  const winnerLabel = winner === playerColor ? selfLabel : oppLabel;
  const winnerDisplayLabel = winner === playerColor ? t("common.you") : winnerLabel;
  const loser = winner === "white" ? "black" : "white";

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
    const scope = isMatchOver ? t("game.matchScope") : t("game.gameScope");
    const cubeSuffix = cube > 1 ? t("game.cubeSuffix", { cube }) : "";

    if (winType === "single") {
      return t("game.wonScope", { winner: winnerDisplayLabel, scope, cube: cubeSuffix });
    }

    return t("game.wonBy", { winner: winnerDisplayLabel, scope, type: t(`game.${winType}`), cube: cubeSuffix });
  }

  function pointExplanation() {
    const base = t(`game.${winType}Points`);
    return cube > 1 ? t("game.doubledPoints", { base, cube, points }) : t("game.sentence", { base });
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
              ? t("game.matchWon")
              : t("game.matchLost")
            : youWonGame
              ? t("game.youWin")
              : t("game.youLost")}
        </h2>

        <p className={styles.subtitle}>{label()}</p>
        <p className={styles.pointsNote}>{pointExplanation()}</p>

        {reason === "leave" && (
          <p className={styles.subtitle} data-testid="opponent-left-note">
            {loser === playerColor ? t("game.youLeft") : t("game.opponentLeft")}
          </p>
        )}

        <div className={styles.scoreboard}>
          {rows.map((row) => (
            <div
              key={row.color}
              className={`${styles.row} ${row.isWinner ? styles.rowWin : ""}`}
              data-testid={`score-row-${row.color}`}
            >
              <span className={styles.nameWrap}>
                <span className={styles.name}>{row.name}</span>
                {row.isYou && <span className={styles.youTag}>{t("common.you")}</span>}
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
              {t("game.nextGame")}
            </button>
          )}
          <button
            onClick={onHome}
            className={`${styles.button} ${isMatchOver ? styles.buttonPrimary : styles.buttonSecondary}`}
          >
            {isMatchOver ? (homeLabel ?? t("game.backHome")) : t("game.quitMatch")}
          </button>
        </div>

        {!isMatchOver && countdown != null && matchTarget > 1 && (
          <p className={styles.autoNote}>
            {t("game.autoNext", { seconds: countdown })}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
