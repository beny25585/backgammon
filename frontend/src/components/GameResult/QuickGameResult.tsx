import GameResult from "./GameResult";

import {
  MatchDetailRow,
  RatingChange,
  ResultMetricRow,
} from "./ResultComparison";

import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

import styles from "./GameResult.module.css";

interface Props {
  winner: Color;

  whiteScore: number;
  blackScore: number;

  whiteName?: string | null;
  blackName?: string | null;

  playerColor?: Color;

  winType?: string | null;
  reason?: string;

  cube: number;
  stakeAmount?: number | null;

  ratingBefore?: number | null;
  ratingAfter?: number | null;

  opponentRatingBefore?: number | null;
  opponentRatingAfter?: number | null;

  ratingChange?: number | null;
  opponentRatingChange?: number | null;

  hits?: number | null;
  doublesOffered?: number | null;
  doublesAccepted?: number | null;

  openingRoll?: Partial<Record<Color, number>> | null;
  firstPlayer?: Color | null;

  durationSeconds?: number | null;

  clockRemaining?: Partial<Record<Color, number>> | null;

  coinsDelta?: number | null;
  opponentCoinsDelta?: number | null;

  onClose: () => void;

  onRematch: () => void;
  rematchPending?: boolean;
  onCancelRematch?: () => void;

  onAnalysis?: () => void;
  onStats?: () => void;
}

function otherColor(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function formatCoins(value?: number | null): string {
  if (value == null) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";

  return `${prefix}${value} GC`;
}

function formatClock(value?: number | null): string {
  if (value == null) {
    return "—";
  }

  /*
   * Clock values currently arrive in milliseconds.
   *
   * 60000 -> 1:00
   * 90500 -> 1:31
   */
  const totalSeconds = Math.max(0, Math.ceil(value / 1000));

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(value?: number | null): string {
  if (value == null) {
    return "—";
  }

  const totalSeconds = Math.max(0, Math.round(value));

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function QuickGameResult({
  winner,

  whiteScore,
  blackScore,

  whiteName,
  blackName,

  playerColor,

  winType,
  reason,

  cube,
  stakeAmount,

  ratingBefore,
  ratingAfter,

  opponentRatingBefore,
  opponentRatingAfter,

  ratingChange,
  opponentRatingChange,

  hits,
  doublesOffered,
  doublesAccepted,

  openingRoll,
  firstPlayer,

  durationSeconds,

  clockRemaining,

  coinsDelta,
  opponentCoinsDelta,

  onClose,

  onRematch,
  rematchPending,
  onCancelRematch,

  onAnalysis,
  onStats,
}: Props) {
  const { t } = useI18n();

  /*
   * Quick Match results are shown as:
   *
   * LEFT  = current player
   * RIGHT = opponent
   */
  const selfColor: Color = playerColor ?? "white";

  const opponentColor = otherColor(selfColor);

  const selfOpeningRoll = openingRoll?.[selfColor];

  const opponentOpeningRoll = openingRoll?.[opponentColor];

  const selfClock = clockRemaining?.[selfColor];

  const opponentClock = clockRemaining?.[opponentColor];

  const hasSelfRating = ratingBefore != null && ratingAfter != null;

  const hasOpponentRating =
    opponentRatingBefore != null && opponentRatingAfter != null;

  const hasRating = hasSelfRating && hasOpponentRating;

  const selfRatingChange =
    ratingChange ?? (hasSelfRating ? ratingAfter! - ratingBefore! : 0);

  const opponentRatingChangeValue =
    opponentRatingChange ??
    (hasOpponentRating ? opponentRatingAfter! - opponentRatingBefore! : 0);

  const hasCoins = coinsDelta != null || opponentCoinsDelta != null;

  const hasOpeningRoll = selfOpeningRoll != null || opponentOpeningRoll != null;

  const hasClock = selfClock != null || opponentClock != null;

  const firstPlayerLabel =
    firstPlayer == null
      ? null
      : firstPlayer === selfColor
        ? t("common.you")
        : firstPlayer === "white"
          ? (whiteName ?? t("common.whitePlayer"))
          : (blackName ?? t("common.blackPlayer"));

  return (
    <GameResult
      winner={winner}
      whiteScore={whiteScore}
      blackScore={blackScore}
      whiteName={whiteName}
      blackName={blackName}
      playerColor={playerColor}
      winType={winType}
      reason={reason}
      onClose={onClose}
      actions={
        rematchPending ? (
          <>
            <button type="button" onClick={onCancelRematch}>
              {t("game.cancel")}
            </button>

            <button type="button" disabled>
              ⏳ {t("game.waitingForOpponent")}
            </button>
          </>
        ) : (
          <>
            {/* BACK */}
            <button type="button" onClick={onClose}>
              <span aria-hidden="true">←</span>

              {t("common.backHome")}
            </button>

            {/* Only show Analysis when it actually works */}
            {onAnalysis && (
              <button type="button" onClick={onAnalysis}>
                <span aria-hidden="true">🔍</span>

                {t("game.analysis")}
              </button>
            )}

            {/* Only show Stats when it actually works */}
            {onStats && (
              <button type="button" onClick={onStats}>
                <span aria-hidden="true">▮▮</span>

                {t("game.stats")}
              </button>
            )}

            {/* REMATCH */}
            <button
              type="button"
              className={styles.rematchButton}
              onClick={onRematch}
            >
              <span aria-hidden="true">↻</span>

              {t("game.rematch")}
            </button>
          </>
        )
      }
    >
      {/* REAL PLAYER-vs-PLAYER DATA */}

      {hasRating && (
        <ResultMetricRow
          left={
            <RatingChange
              before={ratingBefore!}
              change={selfRatingChange}
              after={ratingAfter!}
            />
          }
          label={t("game.galaxyRating")}
          right={
            <RatingChange
              before={opponentRatingBefore!}
              change={opponentRatingChangeValue}
              after={opponentRatingAfter!}
            />
          }
        />
      )}

      {hasCoins && (
        <ResultMetricRow
          left={formatCoins(coinsDelta)}
          label={t("game.galaxyCoins")}
          right={formatCoins(opponentCoinsDelta)}
        />
      )}

      {hasOpeningRoll && (
        <ResultMetricRow
          left={selfOpeningRoll ?? "—"}
          label={t("match.openingRoll")}
          right={opponentOpeningRoll ?? "—"}
        />
      )}

      {hasClock && (
        <ResultMetricRow
          left={formatClock(selfClock)}
          label={t("match.clockRemaining")}
          right={formatClock(opponentClock)}
        />
      )}

      {/* REAL MATCH DETAILS */}

      {stakeAmount != null && (
        <MatchDetailRow label={t("match.stake")} value={`${stakeAmount} GC`} />
      )}

      <MatchDetailRow label={t("common.doublingCube")} value={String(cube)} />

      {hits != null && (
        <MatchDetailRow label={t("match.hits")} value={String(hits)} />
      )}

      {doublesOffered != null && (
        <MatchDetailRow
          label={t("match.doublesOffered")}
          value={String(doublesOffered)}
        />
      )}

      {doublesAccepted != null && (
        <MatchDetailRow
          label={t("match.doublesAccepted")}
          value={String(doublesAccepted)}
        />
      )}

      {firstPlayerLabel && (
        <MatchDetailRow
          label={t("match.firstPlayer")}
          value={firstPlayerLabel}
        />
      )}

      {durationSeconds != null && (
        <MatchDetailRow
          label={t("match.duration")}
          value={formatDuration(durationSeconds)}
        />
      )}
    </GameResult>
  );
}
