import GameResult from "./GameResult";

import { RatingChange, ResultMetricRow } from "./ResultComparison";

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
  reason,

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

  onAnalysis,
  onStats,
}: Props) {
  const { t } = useI18n();

  const hasSelfRating = ratingBefore != null && ratingAfter != null;

  const hasOpponentRating =
    opponentRatingBefore != null && opponentRatingAfter != null;

  const selfRatingChange =
    ratingChange ?? (hasSelfRating ? ratingAfter! - ratingBefore! : 0);

  const opponentRatingChangeValue =
    opponentRatingChange ??
    (hasOpponentRating ? opponentRatingAfter! - opponentRatingBefore! : 0);

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
