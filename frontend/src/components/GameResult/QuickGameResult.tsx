import ResultSummary from "./ResultSummary";
import GameResult from "./GameResult";
import { useI18n } from "../../i18n/I18nProvider";

import type { RematchGameResultProps } from "./types";
import styles from "./GameResult.module.css";

type Props = RematchGameResultProps;

export default function QuickGameResult({
  roomId,
  winner,
  whiteScore,
  blackScore,
  whiteName,
  blackName,
  playerColor,
  winType,
  reason,
  ratingBefore,
  ratingAfter,
  opponentRatingBefore,
  opponentRatingAfter,
  ratingChange,
  opponentRatingChange,
  durationSeconds,
  coinsDelta,
  opponentCoinsDelta,
  onClose,
  onRematch,
  rematchPending,
  onCancelRematch,
}: Props) {
  const { t } = useI18n();
  return (
    <GameResult
      variant="quick"
      playerColor={playerColor}
      winner={winner}
      whiteScore={whiteScore}
      blackScore={blackScore}
      whiteName={whiteName}
      blackName={blackName}
      winType={winType}
      reason={reason}
      onClose={onClose}
      actions={
        rematchPending ? (
          <>
            <button
              type="button"
              onClick={onCancelRematch}
              className={styles.secondaryAction}
            >
              {t("game.cancel")}
            </button>

            <button type="button" disabled className={styles.primaryAction}>
              ⏳ {t("game.waitingForOpponent")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRematch}
              className={styles.rematchButton}
            >
              ↻ {t("game.rematch")}
            </button>

            <button
              type="button"
              onClick={onClose}
              className={styles.secondaryAction}
            >
              {t("common.backHome")}
            </button>
          </>
        )
      }
    >
      <ResultSummary
        key={roomId ?? "local"}
        roomId={roomId}
        playerColor={playerColor}
        ratingBefore={ratingBefore}
        ratingAfter={ratingAfter}
        ratingChange={ratingChange}
        opponentRatingBefore={opponentRatingBefore}
        opponentRatingAfter={opponentRatingAfter}
        opponentRatingChange={opponentRatingChange}
        durationSeconds={durationSeconds}
        coinsDelta={coinsDelta}
        opponentCoinsDelta={opponentCoinsDelta}
      />
    </GameResult>
  );
}
