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

function initialFor(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
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
  const { t, locale } = useI18n();
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
  const winLabels = {
    single: t("game.regularWin"),
    gammon: t("game.gammonWin"),
    backgammon: t("game.backgammonWin"),
  };
  const pointExplanations = {
    single: t("game.regularExplanation"),
    gammon: t("game.gammonExplanation"),
    backgammon: t("game.backgammonExplanation"),
  };

  const winnerScore = matchScore[winner] ?? 0;
  const loserScore = matchScore[loser] ?? 0;
  const loserLabel = loser === playerColor ? selfLabel : oppLabel;

  function label() {
    if (locale === "he") {
      const scope = isMatchOver ? "במשחק" : "במערכה הזאת";
      const cubeSuffix = cube > 1 ? ` (${t("common.doublingCube")} פי ${cube})` : "";
      const verb = winner === playerColor ? "ניצחת" : `${winnerDisplayLabel} ניצח`;

      if (winType === "single") {
        return `${verb} ${scope}${cubeSuffix}`;
      }

      return `${verb} ${scope} ב${winLabels[winType]}${cubeSuffix}`;
    }

    const scope = isMatchOver ? "the match" : "this game";
    const cubeSuffix = cube > 1 ? ` (cube ×${cube})` : "";

    if (winType === "single") {
      return t("game.wonScope", { winner: winnerDisplayLabel, scope, cube: cubeSuffix });
    }

    return t("game.wonBy", {
      winner: winnerDisplayLabel,
      scope,
      type: winLabels[winType],
      cube: cubeSuffix,
    });
  }

  function pointExplanation() {
    const base = pointExplanations[winType];
    if (locale === "he") {
      return cube > 1 ? `${base} קוביית ההכפלה מעלה את הערך ל-${points} נקודות.` : base;
    }
    return cube > 1 ? `${base}; doubled by cube ×${cube} to ${points} points.` : `${base}.`;
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
        <button
          type="button"
          className={styles.closeButton}
          aria-label={isMatchOver ? (homeLabel ?? t("common.backHome")) : t("game.quitMatch")}
          onClick={onHome}
        >
          ×
        </button>

        <div className={styles.resultHeader}>
          {isMatchOver && <span className={styles.resultMark} aria-hidden="true" />}
          <p className={styles.kicker}>
            {isMatchOver ? t("game.matchResult") : t("game.gameResult")}
          </p>
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
        </div>

        <div className={styles.heroResult}>
          <div className={`${styles.playerPanel} ${styles.winnerPanel}`}>
            <span className={styles.playerRole}>{t("game.winner")}</span>
            <span className={styles.avatar}>{initialFor(winnerLabel)}</span>
            <span className={styles.playerName}>{winnerLabel}</span>
          </div>

          <div className={styles.scoreLockup} aria-label={t("match.score")}>
            <AnimatedNumber
              from={Math.max(0, winnerScore - points)}
              to={winnerScore}
              className={styles.heroScore}
              data-testid={`score-${winner}`}
            />
            <span className={styles.scoreDivider}>-</span>
            <span className={styles.heroScore} data-testid={`score-${loser}`}>
              {loserScore}
            </span>
          </div>

          <div className={`${styles.playerPanel} ${styles.loserPanel}`}>
            <span className={styles.playerRole}>{t("game.loser")}</span>
            <span className={styles.avatar}>{initialFor(loserLabel)}</span>
            <span className={styles.playerName}>{loserLabel}</span>
          </div>
        </div>

        <p className={styles.subtitle}>{label()}</p>

        {reason === "leave" && (
          <p className={styles.subtitle} data-testid="opponent-left-note">
            {loser === playerColor ? t("game.youLeft") : t("game.opponentLeft")}
          </p>
        )}

        <div className={styles.scoreboard}>
          <div className={styles.statRow}>
            <span>{t("game.levelOfPlay")}</span>
            <strong>{youWonMatch ? t("game.galactic") : t("game.beginner")}</strong>
          </div>
          <div className={styles.statRow}>
            <span>{t("game.matchScore")}</span>
            <strong>{winnerScore} - {loserScore}</strong>
          </div>
          <div className={styles.statRow}>
            <span>{t("game.pointsAwarded")}</span>
            <strong>+{points}</strong>
          </div>
          <div className={styles.statRow}>
            <span>{t("common.doublingCube")}</span>
            <strong>×{cube}</strong>
          </div>
          <div className={styles.statRow}>
            <span>{t("match.result")}</span>
            <strong>{winLabels[winType]}</strong>
          </div>
        </div>

        <p className={styles.pointsNote}>{pointExplanation()}</p>

        <div className={styles.buttonRow}>
          {!isMatchOver && (
            <button
              onClick={onNext}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {t("game.nextGameAction")}
            </button>
          )}
          <button
            onClick={onHome}
            className={`${styles.button} ${isMatchOver ? styles.buttonPrimary : styles.buttonSecondary}`}
          >
            {isMatchOver ? (homeLabel ?? t("common.backHome")) : t("game.quitMatch")}
          </button>
        </div>

        {!isMatchOver && countdown != null && matchTarget > 1 && (
          <p className={styles.autoNote}>
            {t("game.nextAuto", { seconds: countdown })}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
