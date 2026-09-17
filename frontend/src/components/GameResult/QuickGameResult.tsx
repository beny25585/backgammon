import GameResult from "./GameResult";

import { RatingChange, ResultMetricRow } from "./ResultComparison";

import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";
import type { RematchState } from "../../types/context";

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
  rematchState?: RematchState;

  onAnalysis?: () => void;
  onStats?: () => void;
}

function formatCoins(value?: number | null): string {
  if (value == null) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";

  return `${prefix}${value}`;
}

export default function QuickGameResult({
  winner,

  whiteScore,
  blackScore,

  whiteName,
  blackName,

  playerColor,

  winType,
  reason: gameReason,

  cube,

  ratingBefore,
  ratingAfter,

  opponentRatingBefore,
  opponentRatingAfter,

  ratingChange,
  opponentRatingChange,

  coinsDelta,
  opponentCoinsDelta,

  onClose,

  onRematch,
  rematchPending,
  onCancelRematch,
  rematchState,

  onAnalysis,
  onStats,
}: Props) {
  const { t } = useI18n();
  const status = rematchState?.status;
  const rematchReason = rematchState?.reason;

  const hasSelfRating = ratingBefore != null && ratingAfter != null;

  const hasOpponentRating =
    opponentRatingBefore != null && opponentRatingAfter != null;

  const selfRatingChange =
    ratingChange ?? (hasSelfRating ? ratingAfter! - ratingBefore! : 0);

  const opponentRatingChangeValue =
    opponentRatingChange ??
    (hasOpponentRating ? opponentRatingAfter! - opponentRatingBefore! : 0);

  // Rematch UI per spec Part 12
  let rematchActions: React.ReactNode;
  if (status === "creating") {
    rematchActions = (
      <button type="button" disabled className={styles.primaryAction}>
        {t("game.rematchStarting")}
      </button>
    );
  } else if (status === "requested" || rematchPending) {
    rematchActions = (
      <>
        <button type="button" onClick={onCancelRematch} className={styles.secondaryAction}>
          {t("game.cancel")}
        </button>
        <button type="button" disabled className={styles.primaryAction}>
          ⏳ {t("game.rematchWaiting")}
        </button>
      </>
    );
  } else if (status === "offered") {
    rematchActions = (
      <>
        <div className={styles.rematchMessage}>{t("game.rematchOffer")}</div>
        <button type="button" onClick={onCancelRematch} className={styles.secondaryAction}>
          {t("game.rematchDecline")}
        </button>
        <button
          type="button"
          className={styles.rematchButton}
          onClick={onRematch}
        >
          {t("game.rematchAccept")}
        </button>
      </>
    );
  } else if (status === "unavailable") {
    if (rematchReason === "tournament") {
      rematchActions = null;
    } else if (rematchReason === "opponent_left") {
      rematchActions = (
        <>
          <button type="button" disabled className={styles.primaryAction}>
            {t("game.rematch")}
          </button>
          <div className={styles.rematchMessage}>{t("game.rematchOpponentLeft")}</div>
        </>
      );
    } else if (rematchReason === "requester_not_eligible") {
      rematchActions = (
        <>
          <button type="button" disabled className={styles.primaryAction}>
            {t("game.rematch")}
          </button>
          <div className={styles.rematchMessage}>{t("game.rematchNoCoins")}</div>
        </>
      );
    } else if (rematchReason === "opponent_not_eligible") {
      rematchActions = (
        <>
          <button type="button" disabled className={styles.primaryAction}>
            {t("game.rematch")}
          </button>
          <div className={styles.rematchMessage}>{t("game.rematchOpponentIneligible")}</div>
        </>
      );
    } else {
      rematchActions = (
        <button type="button" disabled className={styles.rematchButton}>
          {t("game.rematch")}
        </button>
      );
    }
  } else {
    rematchActions = (
      <button
        type="button"
        className={styles.rematchButton}
        onClick={onRematch}
      >
        <span aria-hidden="true">↻</span>
        {t("game.rematch")}
      </button>
    );
  }

  return (
    <GameResult
      variant="quick"
      winner={winner}
      whiteScore={whiteScore}
      blackScore={blackScore}
      whiteName={whiteName}
      blackName={blackName}
      playerColor={playerColor}
      winType={winType}
      reason={gameReason}
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose} className={styles.secondaryAction}>
            <span aria-hidden="true">←</span>
            {t("common.backHome")}
          </button>
          {onAnalysis && (
            <button type="button" onClick={onAnalysis} className={styles.secondaryAction}>
              <span aria-hidden="true">🔍</span>
              {t("game.analysis")}
            </button>
          )}
          {onStats && (
            <button type="button" onClick={onStats} className={styles.secondaryAction}>
              <span aria-hidden="true">▮▮</span>
              {t("game.stats")}
            </button>
          )}
          {rematchActions}
        </>
      }
    >
      <ResultMetricRow
        left={
          ratingBefore != null &&
          ratingAfter != null &&
          selfRatingChange != null ? (
            <RatingChange
              before={ratingBefore}
              change={selfRatingChange}
              after={ratingAfter}
            />
          ) : (
            "-"
          )
        }
        label={t("game.rating")}
        right={
          opponentRatingBefore != null &&
          opponentRatingAfter != null &&
          opponentRatingChangeValue != null ? (
            <RatingChange
              before={opponentRatingBefore}
              change={opponentRatingChangeValue}
              after={opponentRatingAfter}
            />
          ) : (
            "-"
          )
        }
      />

      <ResultMetricRow
        left={coinsDelta != null ? formatCoins(coinsDelta) : "-"}
        label={t("game.coins")}
        right={opponentCoinsDelta != null ? formatCoins(opponentCoinsDelta) : "-"}
      />

      <ResultMetricRow
        left={String(cube)}
        label={t("common.doublingCube")}
        right={String(cube)}
      />
    </GameResult>
  );
}
