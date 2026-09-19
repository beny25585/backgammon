import ResultSummary from "./ResultSummary";
import GameResult from "./GameResult";
import { MatchDetailRow, ResultMetricRow } from "./ResultComparison";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color } from "../../lib/backgammon/engine";

interface Props {
  roomId?: string;
  coinsDelta?: number | null;
  opponentCoinsDelta?: number | null;
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
  roomId,
  coinsDelta,
  opponentCoinsDelta,
  winner,
  whiteScore,
  blackScore,
  whiteName,
  blackName,
  playerColor,
  winnerIsWhite,
  winType,
  reason,
  tournamentRound,
  nextOpponent,
  ratingBefore,
  ratingAfter,
  opponentRatingBefore,
  opponentRatingAfter,
  ratingChange,
  opponentRatingChange,
  durationSeconds,
  onClose,
  onViewTournament,
  onViewBracket,
}: Props) {
  const { t } = useI18n();
  const selfWon = winner === (playerColor ?? (winnerIsWhite ? "white" : "black"));
  const hasRound = !!tournamentRound;
  const hasNextOpponent = !!nextOpponent;
  return (
    <GameResult
      variant="tournament"
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
        <>
          <button
            type="button"
            onClick={onViewTournament ?? onClose}
            style={{
              minWidth: 120,
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid rgba(229,180,77,0.2)",
              background: "rgba(255,255,255,0.06)",
              color: "#f0e3cd",
            }}
          >
            {t("game.viewTournament")}
          </button>
          <button
            type="button"
            onClick={onViewBracket ?? onClose}
            style={{
              minWidth: 120,
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid rgba(229,180,77,0.2)",
              background: "rgba(255,255,255,0.06)",
              color: "#f0e3cd",
            }}
          >
            {t("game.viewBracket")}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              minWidth: 140,
              padding: "8px 16px",
              borderRadius: 999,
              background: "#e7bd72",
              color: "#0f2a2f",
              border: "1px solid #e7bd72",
            }}
          >
            {t("game.backToTournament")}
          </button>
        </>
      }
    >
      <ResultMetricRow label={t("game.result")} left={t(selfWon ? "common.won" : "common.lost")} right={t(selfWon ? "common.lost" : "common.won")} />
      <ResultSummary key={roomId ?? "local"} coinsDelta={coinsDelta} opponentCoinsDelta={opponentCoinsDelta} roomId={roomId} playerColor={playerColor}
        ratingBefore={ratingBefore} ratingAfter={ratingAfter} ratingChange={ratingChange}
        opponentRatingBefore={opponentRatingBefore} opponentRatingAfter={opponentRatingAfter}
        opponentRatingChange={opponentRatingChange} durationSeconds={durationSeconds}
        
      />
      {hasRound && <MatchDetailRow label={t("game.round")} value={tournamentRound!} />}
      {hasNextOpponent && <MatchDetailRow label={t("game.nextMatch")} value={nextOpponent!} />}
    </GameResult>
  );
}
