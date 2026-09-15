import GameResult from "./GameResult";
import { MatchDetailRow } from "./ResultComparison";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

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
}

export default function PrivateGameResult({
  winner,
  whiteScore,
  blackScore,
  whiteName,
  blackName,
  playerColor,
  winType,
  reason,
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
}: Props) {
  const { t } = useI18n();
  const openingRollText = openingRoll && (openingRoll.white ?? openingRoll.black)
    ? `${openingRoll.white ?? "-"} / ${openingRoll.black ?? "-"}`
    : null;
  const firstPlayerLabel = firstPlayer ? (firstPlayer === "white" ? whiteName ?? t("common.whitePlayer") : blackName ?? t("common.blackPlayer")) : null;
  const clockText = clockRemaining
    ? `${clockRemaining.white ?? "-"} / ${clockRemaining.black ?? "-"}`
    : null;

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
            <button type="button" onClick={onCancelRematch} style={{ minWidth: 120, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(229,180,77,0.2)", background: "rgba(255,255,255,0.06)", color: "#f0e3cd" }}>{t("game.cancel")}</button>
            <button type="button" disabled style={{ minWidth: 140, padding: "8px 16px", borderRadius: 999, background: "#e7bd72", color: "#0f2a2f" }}>⏳ {t("game.waitingForOpponent")}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onRematch} style={{ minWidth: 120, padding: "8px 16px", borderRadius: 999, background: "#e7bd72", color: "#0f2a2f", border: "1px solid #e7bd72" }}>↻ {t("game.rematch")}</button>
            <button type="button" onClick={onClose} style={{ minWidth: 120, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(229,180,77,0.2)", background: "rgba(255,255,255,0.06)", color: "#f0e3cd" }}>{t("common.backHome")}</button>
          </>
        )
      }
    >
      <MatchDetailRow label={t("common.doublingCube")} value={String(cube)} />
      {hits != null && <MatchDetailRow label={t("match.hits")} value={String(hits)} />}
      {doublesOffered != null && <MatchDetailRow label="Doubles Offered" value={String(doublesOffered)} />}
      {doublesAccepted != null && <MatchDetailRow label="Doubles Accepted" value={String(doublesAccepted)} />}
      {openingRollText && <MatchDetailRow label="Opening Roll" value={openingRollText} />}
      {firstPlayerLabel && <MatchDetailRow label={t("match.firstPlayer")} value={firstPlayerLabel} />}
      {durationSeconds != null && <MatchDetailRow label={t("match.duration")} value={`${durationSeconds}s`} />}
      {clockText && <MatchDetailRow label="Clock Remaining" value={clockText} />}
    </GameResult>
  );
}
