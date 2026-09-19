import ResultSummary from "./ResultSummary";
import GameResult from "./GameResult";
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
  showRematch?: boolean;
  onPracticeAgain?: () => void;
  rematchPending?: boolean;
  onCancelRematch?: () => void;
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
  const { t, locale } = useI18n();
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
              style={{
                minWidth: 120,
                padding: "8px 16px",
                borderRadius: 999,
                border: "1px solid rgba(229,180,77,0.2)",
                background: "rgba(255,255,255,0.06)",
                color: "#f0e3cd",
              }}
            >
              {t("game.cancel")}
            </button>
            <button
              type="button"
              disabled
              style={{
                minWidth: 140,
                padding: "8px 16px",
                borderRadius: 999,
                background: "#e7bd72",
                color: "#0f2a2f",
              }}
            >
              ⏳ {t("game.waitingForOpponent")}
            </button>
          </>
        ) : (
          <>
            {onPracticeAgain && <button type="button" onClick={onPracticeAgain}
              style={{ minHeight: 44, padding: '8px 16px', borderRadius: 999, background: '#e7bd72', color: '#0f2a2f', border: '1px solid #e7bd72' }}>
              {locale === 'he' ? 'משחק נוסף · בחירת רמה והגדרות' : 'Play again · Level & settings'}
            </button>}
            {showRematch && <button
              type="button"
              onClick={onRematch}
              style={{
                minWidth: 120,
                padding: "8px 16px",
                borderRadius: 999,
                background: "#e7bd72",
                color: "#0f2a2f",
                border: "1px solid #e7bd72",
              }}
            >
              ↻ {t("game.rematch")}
            </button>}
            <button
              type="button"
              onClick={onClose}
              style={{
                minWidth: 120,
                padding: "8px 16px",
                borderRadius: 999,
                border: "1px solid rgba(229,180,77,0.2)",
                background: "rgba(255,255,255,0.06)",
                color: "#f0e3cd",
              }}
            >
              {t("common.backHome")}
            </button>
          </>
        )
      }
    >
      <ResultSummary key={roomId ?? "local"} coinsDelta={coinsDelta} opponentCoinsDelta={opponentCoinsDelta} roomId={roomId} playerColor={playerColor}
        ratingBefore={ratingBefore} ratingAfter={ratingAfter} ratingChange={ratingChange}
        opponentRatingBefore={opponentRatingBefore} opponentRatingAfter={opponentRatingAfter}
        opponentRatingChange={opponentRatingChange} durationSeconds={durationSeconds}
        
      />
    </GameResult>
  );
}
