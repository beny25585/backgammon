import GameResult from "./GameResult";
import { MatchDetailRow } from "./ResultComparison";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./GameResult.module.css";
import type { Color } from "../../lib/backgammon/engine";
import type { RematchState } from "../../types/context";

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
  onClose: () => void;
  onRematch: () => void;
  rematchPending?: boolean;
  onCancelRematch?: () => void;
  rematchState?: RematchState;
  showRematch?: boolean;
  closeLabel?: string;
}

export default function PrivateGameResult({
  winner,
  whiteScore,
  blackScore,
  whiteName,
  blackName,
  playerColor,
  winType,
  reason: gameReason,
  cube,
  hits,
  doublesOffered,
  doublesAccepted,
  openingRoll,
  firstPlayer,
  durationSeconds,
  clockRemaining,
  onClose,
  onRematch,
  rematchPending,
  onCancelRematch,
  rematchState,
  showRematch = true,
  closeLabel,
}: Props) {
  const { t } = useI18n();
  const status = rematchState?.status;
  const rematchReason = rematchState?.reason;
  const openingRollText = openingRoll && (openingRoll.white ?? openingRoll.black)
    ? `${openingRoll.white ?? "-"} / ${openingRoll.black ?? "-"}`
    : null;
  const firstPlayerLabel = firstPlayer ? (firstPlayer === "white" ? whiteName ?? t("common.whitePlayer") : blackName ?? t("common.blackPlayer")) : null;
  const clockText = clockRemaining
    ? `${clockRemaining.white ?? "-"} / ${clockRemaining.black ?? "-"}`
    : null;

  // Build rematch actions per spec
  let rematchNode: React.ReactNode;
  if (!showRematch) {
    rematchNode = null;
  } else if (status === "creating") {
    rematchNode = (
      <button type="button" disabled className={styles.primaryAction}>{t("game.rematchStarting")}</button>
    );
  } else if (status === "requested" || rematchPending) {
    rematchNode = (
      <>
        <button type="button" onClick={onCancelRematch} className={styles.secondaryAction}>{t("game.cancel")}</button>
        <button type="button" disabled className={styles.primaryAction}>⏳ {t("game.rematchWaiting")}</button>
      </>
    );
  } else if (status === "offered") {
    rematchNode = (
      <>
        <div className={styles.rematchMessage}>{t("game.rematchOffer")}</div>
        <button type="button" onClick={onCancelRematch} className={styles.secondaryAction}>{t("game.rematchDecline")}</button>
        <button type="button" onClick={onRematch} className={styles.primaryAction}>{t("game.rematchAccept")}</button>
      </>
    );
  } else if (status === "unavailable") {
    if (rematchReason === "tournament") {
      rematchNode = null;
    } else if (rematchReason === "opponent_left") {
      rematchNode = (
        <>
          <button type="button" disabled className={styles.primaryAction}>↻ {t("game.rematch")}</button>
          <div className={styles.rematchMessage}>{t("game.rematchOpponentLeft")}</div>
        </>
      );
    } else if (rematchReason === "requester_not_eligible") {
      rematchNode = (
        <>
          <button type="button" disabled className={styles.primaryAction}>↻ {t("game.rematch")}</button>
          <div className={styles.rematchMessage}>{t("game.rematchNoCoins")}</div>
        </>
      );
    } else if (rematchReason === "opponent_not_eligible") {
      rematchNode = (
        <>
          <button type="button" disabled className={styles.primaryAction}>↻ {t("game.rematch")}</button>
          <div className={styles.rematchMessage}>{t("game.rematchOpponentIneligible")}</div>
        </>
      );
    } else {
      rematchNode = (
        <button type="button" disabled className={styles.primaryAction}>↻ {t("game.rematch")}</button>
      );
    }
  } else {
    rematchNode = (
      <button type="button" onClick={onRematch} className={styles.primaryAction}>↻ {t("game.rematch")}</button>
    );
  }

  return (
    <GameResult
      variant="private"
      winner={winner}
      whiteScore={whiteScore}
      blackScore={blackScore}
      whiteName={whiteName}
      blackName={blackName}
      playerColor={playerColor}
      winType={winType}
      reason={gameReason}
      closeLabel={closeLabel}
      onClose={onClose}
      actions={
        !showRematch ? (
          <button type="button" onClick={onClose} className={styles.secondaryAction}>{closeLabel ?? t("common.backHome")}</button>
        ) : (
          <>
            {rematchNode}
            <button type="button" onClick={onClose} className={styles.secondaryAction}>{closeLabel ?? t("common.backHome")}</button>
          </>
        )
      }
    >
      <MatchDetailRow label={t("common.doublingCube")} value={<bdi dir="ltr">{String(cube)}</bdi>} />
      {hits != null && <MatchDetailRow label={t("match.hits")} value={<bdi dir="ltr">{String(hits)}</bdi>} />}
      {doublesOffered != null && <MatchDetailRow label={t("match.doublesOffered")} value={<bdi dir="ltr">{String(doublesOffered)}</bdi>} />}
      {doublesAccepted != null && <MatchDetailRow label={t("match.doublesAccepted")} value={<bdi dir="ltr">{String(doublesAccepted)}</bdi>} />}
      {openingRollText && <MatchDetailRow label={t("match.openingRoll")} value={<bdi dir="ltr">{openingRollText}</bdi>} />}
      {firstPlayerLabel && <MatchDetailRow label={t("match.firstPlayer")} value={firstPlayerLabel} />}
      {durationSeconds != null && <MatchDetailRow label={t("match.duration")} value={<bdi dir="ltr">{`${durationSeconds}s`}</bdi>} />}
      {clockText && <MatchDetailRow label={t("match.clockRemaining")} value={<bdi dir="ltr">{clockText}</bdi>} />}
    </GameResult>
  );
}
