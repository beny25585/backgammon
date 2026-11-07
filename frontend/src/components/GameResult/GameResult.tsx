import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

import styles from "./GameResult.module.css";

export type GameResultVariant = "private" | "quick" | "tournament";

export interface BaseGameResultProps {
  variant?: GameResultVariant;
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

const RESULT_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

interface ResultPlayerProps {
  color: Color;
  name: string;
  role: string;
  winner: boolean;
}

function ResultChecker({ color }: { color: Color }) {
  return (
    <span
      aria-hidden="true"
      className={styles.checker + " " + (color === "white" ? styles.checkerWhite : styles.checkerBlack)}
    />
  );
}

function ResultPlayer({ color, name, role, winner }: ResultPlayerProps) {
  return (
    <div className={styles.resultPlayer} role="group" aria-label={role}>
      <ResultChecker color={color} />
      <bdi className={styles.playerName} title={name}>{name}</bdi>
      {winner && (
        <motion.span
          aria-hidden="true"
          data-result-winner
          className="shrink-0 rounded-full border border-[#d3a766] px-[clamp(4px,1.5cqw,16px)] py-[clamp(2px,0.55cqw,5px)] text-[clamp(9px,1.94cqw,19px)] leading-none font-bold text-[#efc781] shadow-[inset_0_0_0_1px_#eaca8e38,0_2px_3px_#0008]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, delay: 0.08, ease: RESULT_EASE }}
        >
          {role}
        </motion.span>
      )}
    </div>
  );
}

function otherColor(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/**
 * Generic reusable Game Result screen.
 *
 * Responsibilities:
 * - Winner / loser presentation
 * - Player color markers
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
  variant = "private",
}: BaseGameResultProps) {
  const { t, direction } = useI18n();
  const reduceMotion = useReducedMotion();
  const resultCard = useRef<HTMLElement>(null);
  useEffect(() => {
    resultCard.current?.focus({ preventScroll: true });
  }, []);
  const winTypeLabel = (() => {
    switch (winType) {
      case "single":
        return t("game.regularWin");

      case "gammon":
        return t("game.gammonWin");

      case "backgammon":
        return t("game.backgammonWin");

      default:
        return null;
    }
  })();

  const reasonLabel = (() => {
    switch (reason) {
      case "give_up":
        return t("game.resultReasonGiveUp");

      case "leave":
        return t("game.resultReasonLeave");

      case "time":
        return t("game.resultReasonTime");

      case "inactivity_timeout":
        return winner === playerColor
          ? t("game.resultReasonInactivity")
          : t("game.resultReasonInactivitySelf");

      case "admin":
        return t("game.resultReasonAdmin");

      default:
        return null;
    }
  })();

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

  return (
    <motion.div
      className={styles.backdrop + " bg-[#100d09]/65"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: reduceMotion ? 0.14 : 0.25,
        ease: RESULT_EASE,
      }}
    >
      <motion.main
        ref={resultCard}
        className={styles.card + " rounded-[clamp(12px,2.5vw,22px)] border-[1.5px] border-transparent text-[#f3e6ce] [background:radial-gradient(ellipse_at_28%_4%,#252523,#191918_90%)_padding-box,linear-gradient(138deg,#efd19d,#ac8550_27%,#76582f_59%,#d0a56d)_border-box] shadow-[0_20px_60px_#0009,inset_0_1px_1px_#fff0ca1f,inset_0_0_0_1px_#f2cb8e1c] focus:outline-none"}
        data-testid="game-result-card"
        data-result-variant={variant}
        dir="ltr"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        initial={reduceMotion ? false : { transform: "scale(0.96)" }}
        animate={{ transform: "scale(1)" }}
        transition={{ duration: 0.25, ease: RESULT_EASE }}
        aria-labelledby="game-result-title"
      >
        <button
          type="button"
          className={styles.closeButton + " grid cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-[#f3e6ce] hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-[#e7bd72] focus-visible:outline-offset-2 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97]"}
          aria-label={closeLabel ?? t("game.closeResult")}
          onClick={onClose}
        >
          <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 16 16m0-16L4 20" />
          </svg>
        </button>

        <div className={styles.resultHero} dir={direction}>
          <h2 id="game-result-title" className={styles.resultTitle}>
            {title ?? t("game.matchResult")}
          </h2>
          <div className={styles.scoreRow} role="group" aria-label={t("match.score")} dir="ltr">
            <span data-testid="score-left">{leftScore}</span>
            <span aria-hidden="true">–</span>
            <span data-testid="score-right">{rightScore}</span>
          </div>
          {reasonLabel && <p className={styles.subtitle}>{reasonLabel}</p>}
          {winTypeLabel && (!reasonLabel || winType !== "single") && <p className={styles.subtitle}>{winTypeLabel}</p>}
          {heroMeta}
          <div className={styles.resultPlayers} dir="ltr">
            <ResultPlayer
              color={leftColor}
              name={leftName}
              role={t(leftIsWinner ? "game.winner" : "game.loser")}
              winner={leftIsWinner}
            />
            <ResultPlayer
              color={rightColor}
              name={rightName}
              role={t(rightIsWinner ? "game.winner" : "game.loser")}
              winner={rightIsWinner}
            />
          </div>
          <span className="sr-only" aria-hidden="true">
            <span data-testid="score-white">{whiteScore}</span>
            <span data-testid="score-black">{blackScore}</span>
          </span>
        </div>

        {children && (
          <section className={styles.resultTable} dir="ltr">
            <div className={styles.tablePlayers} aria-hidden="true">
              <span className={styles.playerValue}>
                <ResultChecker color={leftColor} />
                <bdi className={styles.playerName}>{leftName}</bdi>
              </span>
              <span className={styles.opponentValue}>
                <ResultChecker color={rightColor} />
                <bdi className={styles.playerName}>{rightName}</bdi>
              </span>
            </div>
            {children}
          </section>
        )}

        {actions && <div className={styles.resultActions} dir={direction}>{actions}</div>}
      </motion.main>
    </motion.div>
  );
}
