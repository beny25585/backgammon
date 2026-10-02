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
  rematchStatus,
  rematchReason,
  rematchReady,
  onAcceptRematch,
  onDeclineRematch,
  onCancelRematch,
}: Props) {
  const { t } = useI18n();
  const status = rematchStatus ?? null;
  const starting = rematchReady === true || status === "creating";
  const unavailableMessage = (() => {
    switch (rematchReason) {
      case "opponent_left":
        return t("game.rematchOpponentLeft");
      case "opponent_not_eligible":
        return t("game.rematchOpponentIneligible");
      case "requester_not_eligible":
        return t("game.rematchRequesterIneligible");
      case "source_not_settled":
      case "settlement_pending":
        return t("game.rematchSettling");
      case "source_room_mismatch":
        return t("game.rematchSourceMismatch");
      case "invalid_source":
        return t("game.rematchInvalidSource");
      case "not_completed":
        return t("game.rematchFinalizing");
      case "service_error":
        return t("game.rematchServiceUnavailable");
      case "no_pending":
        return t("game.rematchNoPending");
      case "cannot_accept_own":
        return t("game.rematchCannotAcceptOwn");
      default:
        return t("game.rematchUnavailable");
    }
  })();
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
        starting ? (
          <button type="button" disabled className={styles.primaryAction}>
            {t("game.rematchStarting")}
          </button>
        ) : status === "requested" ? (
          <>
            <button
              type="button"
              onClick={onCancelRematch}
              className={styles.secondaryAction}
            >
              {t("game.cancel")}
            </button>

            <button type="button" disabled className={styles.primaryAction}>
              ⏳ {t("game.rematchWaiting")}
            </button>
          </>
        ) : status === "offered" ? (
          <>
            <button
              type="button"
              onClick={onAcceptRematch}
              className={styles.rematchButton}
            >
              {t("game.rematchAccept")}
            </button>

            <button
              type="button"
              onClick={onDeclineRematch}
              className={styles.secondaryAction}
            >
              {t("game.rematchDecline")}
            </button>
          </>
        ) : status === "unavailable" ? (
          <>
            <button type="button" disabled className={styles.primaryAction}>
              {unavailableMessage}
            </button>

            <button
              type="button"
              onClick={onClose}
              className={styles.secondaryAction}
            >
              {t("common.backHome")}
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
