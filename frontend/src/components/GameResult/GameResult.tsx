import type { ReactNode } from "react";
import { motion } from "motion/react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

import styles from "./GameResult.module.css";

export interface BaseGameResultProps {
  winner: Color;

  whiteScore: number;
  blackScore: number;

  whiteName?: string | null;
  blackName?: string | null;

  /**
   * Current player's color.
   *
   * When provided:
   * LEFT  = current player
   * RIGHT = opponent
   *
   * When omitted:
   * LEFT  = white
   * RIGHT = black
   */
  playerColor?: Color;

  /**
   * Optional result description.
   *
   * Examples:
   * - Backgammon
   * - Gammon
   * - Regular win
   */
  winType?: string | null;

  /**
   * Optional reason why the game ended.
   *
   * Examples:
   * - Opponent left
   * - Timeout
   * - Resignation
   */
  reason?: string | null;

  /**
   * Defaults to the translated "Match Result".
   */
  title?: string;

  /**
   * Called when the close button is pressed.
   *
   * The parent decides whether this means:
   * - Back to Home
   * - Back to Lobby
   * - Back to Tournament
   */
  onClose: () => void;

  closeLabel?: string;

  /**
   * Extra content displayed below the score
   * and above the result table.
   *
   * Example:
   * - ANALYSIS SETTINGS
   * - Free Member / Info
   */
  heroMeta?: ReactNode;

  /**
   * Mode-specific action buttons.
   *
   * Examples:
   * - Analysis
   * - Stats
   * - Rematch
   * - Back to Lobby
   */
  actions?: ReactNode;

  /**
   * Mode-specific result rows.
   *
   * Examples:
   * - Performance
   * - Error Rate
   * - Rating
   * - Coins
   * - Luck
   * - Tournament progression
   */
  children?: ReactNode;
}

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function otherColor(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/**
 * Generic reusable Game Result screen.
 *
 * Responsibilities:
 * - Winner / loser presentation
 * - Player avatars
 * - Player names
 * - Final score
 * - Winner highlight
 * - Responsive result layout
 * - Optional hero metadata
 * - Result data slot
 * - Actions slot
 *
 * It intentionally does NOT know anything about:
 * - Tournament logic
 * - Quick match logic
 * - Wallet / coins calculations
 * - Rating calculations
 * - Performance analysis
 * - Rematch rules
 *
 * Those are supplied by the parent component.
 */
export default function GameResult({
  winner,

  whiteScore,
  blackScore,

  whiteName,
  blackName,

  playerColor,

  winType,
  reason,

  title,

  onClose,
  closeLabel,

  heroMeta,

  actions,
  children,
}: BaseGameResultProps) {
  const { t, direction } = useI18n();

  const leftColor: Color = playerColor ?? "white";
  const rightColor: Color = otherColor(leftColor);

  const leftScore = leftColor === "white" ? whiteScore : blackScore;

  const rightScore = rightColor === "white" ? whiteScore : blackScore;

  const leftName =
    leftColor === "white"
      ? (whiteName ?? t("common.whitePlayer"))
      : (blackName ?? t("common.blackPlayer"));

  const rightName =
    rightColor === "white"
      ? (whiteName ?? t("common.whitePlayer"))
      : (blackName ?? t("common.blackPlayer"));

  const leftIsWinner = winner === leftColor;
  const rightIsWinner = winner === rightColor;

  /**
   * LEFT = current player
   * RIGHT = opponent
   *
   * Do not position players based on winner / loser.
   * Otherwise the UI changes sides depending on the result.
   */

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.22,
        ease: "easeOut",
      }}
    >
      <motion.main
        className={styles.card}
        initial={{
          opacity: 0,
          scale: 0.98,
          y: 16,
        }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
        }}
        exit={{
          opacity: 0,
          scale: 0.98,
          y: 10,
        }}
        transition={{
          type: "spring",
          stiffness: 260,
          damping: 24,
        }}
        aria-labelledby="game-result-title"
      >
        {/* CLOSE */}
        <button
          type="button"
          className={styles.closeButton}
          aria-label={closeLabel ?? t("common.backHome")}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>

        {/* HERO */}
        <div className={styles.resultHero} dir="ltr">
          {/* LEFT PLAYER */}
          <section
            dir={direction}
            className={[
              styles.playerCard,
              leftIsWinner ? styles.playerWinner : styles.playerLoser,
            ].join(" ")}
            aria-label={leftIsWinner ? t("game.winner") : t("game.loser")}
          >
            <span className={styles.playerRole}>
              {leftIsWinner ? (
                <>
                  {t("game.winner")}

                  <span aria-hidden="true"> 👑</span>
                </>
              ) : (
                t("game.loser")
              )}
            </span>

            <span
              className={[
                styles.playerAvatarWrap,
                leftIsWinner ? styles.winnerHighlight : "",
              ].join(" ")}
            >
              <span
                className={[
                  styles.playerAvatar,
                  leftIsWinner ? styles.playerAvatarWinner : "",
                ].join(" ")}
              >
                {initialFor(leftName)}
              </span>
            </span>

            <span className={styles.playerName}>
              <span
                className={[
                  styles.dot,
                  leftIsWinner ? styles.dotWinner : "",
                ].join(" ")}
                aria-hidden="true"
              />

              <span className={styles.playerNameText}>{leftName}</span>
            </span>
          </section>

          {/* CENTER */}
          <section dir={direction} className={styles.scoreColumn}>
            <p id="game-result-title" className={styles.resultTitle}>
              {title ?? t("game.matchResult")}
            </p>

            <div
              className={styles.scoreRow}
              aria-label={t("match.score")}
              dir="ltr"
            >
              <span className={styles.scoreBox} data-testid="score-left">
                {leftScore}
              </span>

              <span className={styles.scoreSeparator} aria-hidden="true">
                –
              </span>

              <span className={styles.scoreBox} data-testid="score-right">
                {rightScore}
              </span>
            </div>

            {winType && <span className={styles.subtitle}>{winType}</span>}

            {reason && <span className={styles.subtitle}>{reason}</span>}

            {/* Example: Analysis settings / Free Member */}
            {heroMeta && <div className={styles.heroMeta}>{heroMeta}</div>}

            {/*
             * Canonical white / black scores.
             * Kept for tests and compatibility.
             */}
            <span className={styles.hiddenScoreRows} aria-hidden="true">
              <span data-testid="score-white">{whiteScore}</span>

              <span data-testid="score-black">{blackScore}</span>
            </span>
          </section>

          {/* RIGHT PLAYER */}
          <section
            dir={direction}
            className={[
              styles.playerCard,
              rightIsWinner ? styles.playerWinner : styles.playerLoser,
            ].join(" ")}
            aria-label={rightIsWinner ? t("game.winner") : t("game.loser")}
          >
            <span className={styles.playerRole}>
              {rightIsWinner ? (
                <>
                  {t("game.winner")}

                  <span aria-hidden="true"> 👑</span>
                </>
              ) : (
                t("game.loser")
              )}
            </span>

            <span
              className={[
                styles.playerAvatarWrap,
                rightIsWinner ? styles.winnerHighlight : "",
              ].join(" ")}
            >
              <span
                className={[
                  styles.playerAvatar,
                  rightIsWinner ? styles.playerAvatarWinner : "",
                ].join(" ")}
              >
                {initialFor(rightName)}
              </span>
            </span>

            <span className={styles.playerName}>
              <span
                className={[
                  styles.dot,
                  rightIsWinner ? styles.dotWinner : "",
                ].join(" ")}
                aria-hidden="true"
              />

              <span className={styles.playerNameText}>{rightName}</span>
            </span>
          </section>
        </div>

        {/* MODE-SPECIFIC RESULT DATA */}
        {children && (
          <section className={styles.resultTable} dir="ltr">
            {children}
          </section>
        )}

        {/* MODE-SPECIFIC ACTIONS */}
        {actions && <div className={styles.resultActions}>{actions}</div>}
      </motion.main>
    </motion.div>
  );
}
