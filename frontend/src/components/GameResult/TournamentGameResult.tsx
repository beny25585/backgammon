import ResultSummary from "./ResultSummary";
import GameResult from "./GameResult";
import { MatchDetailRow, ResultMetricRow } from "./ResultComparison";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./GameResult.module.css";

import type { CommonGameResultProps } from "./types";

interface Props extends CommonGameResultProps {
  tournamentRound?: string;
  nextOpponent?: string | null;

  winnerIsWhite: boolean;

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
  const selfWon =
    winner === (playerColor ?? (winnerIsWhite ? "white" : "black"));
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
            className={styles.secondaryAction}
          >
            {t("game.viewTournament")}
          </button>

          <button
            type="button"
            onClick={onViewBracket ?? onClose}
            className={styles.secondaryAction}
          >
            {t("game.viewBracket")}
          </button>

          <button
            type="button"
            onClick={onClose}
            className={styles.primaryAction}
          >
            {t("game.backToTournament")}
          </button>
        </>
      }
    >
      <ResultMetricRow
        label={t("game.result")}
        left={t(selfWon ? "common.won" : "common.lost")}
        right={t(selfWon ? "common.lost" : "common.won")}
      />
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
      {hasRound && (
        <MatchDetailRow label={t("game.round")} value={tournamentRound!} />
      )}
      {hasNextOpponent && (
        <MatchDetailRow label={t("game.nextMatch")} value={nextOpponent!} />
      )}
    </GameResult>
  );
}
