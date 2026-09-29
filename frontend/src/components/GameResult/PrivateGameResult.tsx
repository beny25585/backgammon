import ResultSummary from "./ResultSummary";
import GameResult from "./GameResult";
import { useI18n } from "../../i18n/I18nProvider";
import type { RematchGameResultProps } from "./types";
import styles from "./GameResult.module.css";

interface Props extends RematchGameResultProps {
  showRematch?: boolean;
  onPracticeAgain?: () => void;
}

export default function PrivateGameResult({
  roomId,
  coinsDelta,
  opponentCoinsDelta,
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
  onClose,
  onRematch,
  showRematch = true,
  onPracticeAgain,
  rematchPending,
  onCancelRematch,
}: Props) {
  const { t } = useI18n();
  return (
    <GameResult
      variant="private"
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
        showRematch && rematchPending ? (
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
            {onPracticeAgain && (
              <button
                type="button"
                onClick={onPracticeAgain}
                className={styles.primaryAction}
              >
                {t("game.playAgainSettings")}
              </button>
            )}
            {showRematch && (
              <button
                type="button"
                onClick={onRematch}
                className={styles.rematchButton}
              >
                ↻ {t("game.rematch")}
              </button>
            )}
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
        coinsDelta={coinsDelta}
        opponentCoinsDelta={opponentCoinsDelta}
        roomId={roomId}
        playerColor={playerColor}
        ratingBefore={ratingBefore}
        ratingAfter={ratingAfter}
        ratingChange={ratingChange}
        opponentRatingBefore={opponentRatingBefore}
        opponentRatingAfter={opponentRatingAfter}
        opponentRatingChange={opponentRatingChange}
        durationSeconds={durationSeconds}
      />
    </GameResult>
  );
}
