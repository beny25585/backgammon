import GameResult from "./GameResult";
import { ResultComparison, ResultMetricRow, MatchDetailRow, RatingChange } from "./ResultComparison";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

function formatReason(reason: string | undefined | null, t: (k: string) => string): string | null {
  if (!reason) return null;
  const map: Record<string, string> = {
    move: t("game.regularWin"),
    bear_off: t("game.regularWin"),
    give_up: t("game.giveUp"),
    leave: t("common.leave"),
    time: "Time Out",
    double: t("game.offerDouble"),
    admin: "Admin",
  };
  return map[reason] ?? reason;
}

interface Props {
  winner: Color;
  whiteScore: number;
  blackScore: number;
  whiteName?: string | null;
  blackName?: string | null;
  playerColor?: Color;
  winType?: string | null;
  reason?: string;
  tournamentRound?: string;
  nextOpponent?: string | null;
  winnerIsWhite: boolean;
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
  onViewTournament?: () => void;
  onViewBracket?: () => void;
}

export default function TournamentGameResult({
  winner,
  whiteScore,
  blackScore,
  whiteName,
  blackName,
  playerColor,
  winType,
  reason,
  tournamentRound,
  nextOpponent,
  winnerIsWhite,
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
  onClose,
  onViewTournament,
  onViewBracket,
}: Props) {
  const { t } = useI18n();
  const hasRound = !!tournamentRound;
  const hasNextOpponent = !!nextOpponent;
  const hasSelfRating = ratingBefore != null && ratingAfter != null;
  const hasOpponentRating = opponentRatingBefore != null && opponentRatingAfter != null;
  const hasRating = hasSelfRating && hasOpponentRating;
  const selfRatingChange = ratingChange ?? (hasSelfRating ? ratingAfter! - ratingBefore! : 0);
  const opponentRatingChangeValue = opponentRatingChange ?? (hasOpponentRating ? opponentRatingAfter! - opponentRatingBefore! : 0);
  // Universal LEFT=self RIGHT=opponent — never white/black or winner/loser alone
  const selfWon = playerColor ? winner === playerColor : winnerIsWhite ? winner === "white" : winner !== "white";
  const selfResult = selfWon ? t("common.won") : t("common.lost");
  const opponentResult = selfWon ? t("common.lost") : t("common.won");
  const openingRollText = openingRoll && (openingRoll.white ?? openingRoll.black)
    ? `${openingRoll.white ?? "-"} / ${openingRoll.black ?? "-"}`
    : null;
  const firstPlayerLabel = firstPlayer ? (firstPlayer === playerColor ? t("common.you") : firstPlayer === "white" ? whiteName ?? t("common.whitePlayer") : blackName ?? t("common.blackPlayer")) : null;
  const clockText = clockRemaining
    ? `${clockRemaining.white ?? "-"} / ${clockRemaining.black ?? "-"}`
    : null;

  const reasonLabel = formatReason(reason, t as never);
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
        <>
          <button type="button" onClick={onViewTournament ?? onClose} style={{ minWidth: 120, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(229,180,77,0.2)", background: "rgba(255,255,255,0.06)", color: "#f0e3cd" }}>{t("game.viewTournament")}</button>
          <button type="button" onClick={onViewBracket ?? onClose} style={{ minWidth: 120, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(229,180,77,0.2)", background: "rgba(255,255,255,0.06)", color: "#f0e3cd" }}>{t("game.viewBracket")}</button>
          <button type="button" onClick={onClose} style={{ minWidth: 140, padding: "8px 16px", borderRadius: 999, background: "#e7bd72", color: "#0f2a2f", border: "1px solid #e7bd72" }}>{t("game.backToTournament")}</button>
        </>
      }
    >
      <ResultComparison>
        <ResultMetricRow left={selfResult} label={t("game.result")} right={opponentResult} leftClassName={selfWon ? "adv" : "elim"} rightClassName={selfWon ? "elim" : "adv"} />
        {hasRating && (
          <ResultMetricRow
            left={<RatingChange before={ratingBefore!} change={selfRatingChange} after={ratingAfter!} />}
            label={t("game.rating")}
            right={<RatingChange before={opponentRatingBefore!} change={opponentRatingChangeValue} after={opponentRatingAfter!} />}
          />
        )}
      </ResultComparison>
      {hasRound && <MatchDetailRow label={t("game.round")} value={tournamentRound!} />}
      {hasNextOpponent && <MatchDetailRow label={t("game.nextMatch")} value={nextOpponent!} />}
      {reasonLabel && <MatchDetailRow label={t("match.endedBy")} value={reasonLabel} />}
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
