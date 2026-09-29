import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import TournamentGameResult from "../GameResult/TournamentGameResult";
import QuickGameResult from "../GameResult/QuickGameResult";
import PrivateGameResult from "../GameResult/PrivateGameResult";
import SamsungDarkModeHelp from "../SamsungDarkModeHelp/SamsungDarkModeHelp";
import { DiceRow } from "../Dice";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color, GameState } from "../../lib/backgammon/engine";
import {
  DEFAULT_BOARD_THEME,
  isBoardTheme,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";

const BOARD_THEME_STORAGE_KEY = "6b-board-theme";

const themeClassByTheme: Record<BoardTheme, string> = {
  redGreen: styles.themeRedGreen,
  blueIvory: styles.themeBlueIvory,
  ivoryGold: styles.themeIvoryGold,
};

function initialBoardTheme(): BoardTheme {
  const saved = window.localStorage.getItem(BOARD_THEME_STORAGE_KEY);
  return isBoardTheme(saved) ? saved : DEFAULT_BOARD_THEME;
}

import type { GameType } from "../../types/context";

interface GameScreenProps {
  closeExisting?: boolean;
  onLeave?: (outcome?: "won" | "lost") => void;
  homeLabel?: string;
  gameType?: GameType;
  showRematch?: boolean;
  onPracticeAgain?: () => void;
}

function hasInterruptedOpeningMove(
  state: GameState | null,
  playerColor: Color,
): boolean {
  if (!state || state.phase !== "rolling" || state.turn !== playerColor)
    return false;
  const { white, black } = state.openingRoll;
  if (white === null || black === null || white === black) return false;
  const winner = white > black ? "white" : "black";
  const message = state.message.toLowerCase();
  return (
    playerColor === winner &&
    state.dice.length === 0 &&
    state.remaining.length === 0 &&
    state.lastMove === null &&
    state.moveHistory === null &&
    (message === `${winner} goes first` || message === `${winner} starts`)
  );
}

export default function GameScreen({
  closeExisting = false,
  onLeave,
  gameType: propGameType,
  showRematch = true,
  onPracticeAgain,
}: GameScreenProps) {
  const [showCloseExisting, setShowCloseExisting] = useState(closeExisting);
  const { t, direction } = useI18n();
  const {
    state,
    roomId,
    playerColor,
    isLoading,
    error,
    aiFailed,
    aiRetrying,
    retryAi,
    clearError,
    makeMove,
    rollDice,
    reorderDice,
    reconnected,
    opponentConnected,
    undoMove,
    endTurn,
    respondToDouble,
    offerDouble,
    clock,
    turnStartedAt,
    timeControl,
    gameResult,
    whiteName,
    blackName,
    openingRollResult,
    noMovesMessage,
    handleNextGame,
    handleHome,
    leaveGame,
    gameType: contextGameType,
  } = useGame();
  const displayedError = (() => {
    switch (error) {
      case "room_cancelled":
        return t("game.roomCancelledMessage");

      case "invalid_room":
        return t("game.leaveInvalidRoom");

      case "room_not_found":
        return t("game.leaveRoomNotFound");

      case "room_not_waiting":
        return t("game.leaveRoomNotWaiting");

      case "room_not_active":
        return t("game.leaveRoomNotActive");

      case "leave_connection_lost":
        return t("game.leaveConnectionLost");

      default:
        return error;
    }
  })();

  const requestLeave = useCallback(() => {
    if (!gameResult?.matchOver) {
      // Request a server-confirmed forfeit without navigating away.
      leaveGame();
      return;
    }

    // Leave only when the player clicks a result-screen return button.
    const outcome = gameResult.winner === playerColor ? "won" : "lost";

    if (onLeave) {
      onLeave(outcome);
    } else {
      handleHome();
    }
  }, [gameResult, onLeave, playerColor, handleHome, leaveGame]);

  const [boardTheme, setBoardTheme] = useState<BoardTheme>(initialBoardTheme);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(
    null,
  );
  const automaticOpeningRollRef = useRef<string | null>(null);
  const gameHasStarted =
    state?.phase === "rolling" ||
    state?.phase === "moving" ||
    state?.phase === "doubling_offered";

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  useEffect(() => {
    window.localStorage.setItem(BOARD_THEME_STORAGE_KEY, boardTheme);
  }, [boardTheme]);

  // The server decides the forfeit. This countdown only makes its 40-second
  // reconnect grace period visible to the player who remains in the room.
  useEffect(() => {
    if (opponentConnected || reconnected || gameResult || !gameHasStarted) {
      setDisconnectCountdown(null);
      return;
    }

    const deadline = Date.now() + 40_000;
    const updateCountdown = () => {
      setDisconnectCountdown(
        Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      );
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [gameHasStarted, gameResult, opponentConnected, reconnected]);

  const interruptedOpeningMove = hasInterruptedOpeningMove(state, playerColor);
  const interruptedOpeningMoveKey =
    interruptedOpeningMove && state
      ? `resume:${state.openingRoll.white}:${state.openingRoll.black}`
      : null;
  const waitingForOpeningRoll =
    state?.phase === "opening_roll" &&
    state.turn === playerColor &&
    state.openingRoll[playerColor] === null;
  const automaticOpeningRollKey =
    interruptedOpeningMoveKey ??
    (waitingForOpeningRoll
      ? `${state.turn}:${state.openingRoll.white ?? "-"}:${state.openingRoll.black ?? "-"}`
      : null);

  useEffect(() => {
    if (!automaticOpeningRollKey) {
      automaticOpeningRollRef.current = null;
      return;
    }
    if (automaticOpeningRollRef.current === automaticOpeningRollKey) return;
    automaticOpeningRollRef.current = automaticOpeningRollKey;
    rollDice();
  }, [automaticOpeningRollKey, rollDice]);

  const isOpeningResult = state?.phase === "opening_result";
  const needsToRoll =
    state?.phase === "rolling" &&
    !interruptedOpeningMove &&
    state.remaining.length === 0 &&
    state.turn === playerColor;
  if (showCloseExisting && !gameResult?.matchOver) {
    return (
      <div className={styles.loading} dir={direction}>
        <div
          className={styles.closeExistingCard}
          role="region"
          aria-labelledby="close-existing-title"
        >
          <h2 id="close-existing-title">{t("game.closeExistingTitle")}</h2>

          <p>{t("game.closeExistingDescription")}</p>

          {displayedError && <p role="alert">{displayedError}</p>}

          <button
            type="button"
            className={styles.closeExistingForfeitButton}
            disabled={isLoading || !state}
            onClick={requestLeave}
          >
            {t("game.closeExistingConfirm")}
          </button>

          <button
            type="button"
            className={styles.closeExistingContinueButton}
            onClick={() => setShowCloseExisting(false)}
          >
            {t("game.closeExistingContinue")}
          </button>
        </div>
      </div>
    );
  }
  if (isLoading) {
    return <div className={styles.loading}>{t("game.connecting")}</div>;
  }

  if (!state) {
    if (error) {
      return (
        <div className={styles.error}>
          {t("game.errorPrefix")}: {displayedError}
          {onLeave && (
            <button type="button" onClick={() => onLeave()}>
              {t("common.backHome")}
            </button>
          )}
        </div>
      );
    }
    return <div className={styles.loading}>{t("game.initializing")}</div>;
  }

  return (
    <div className={`${styles.container} ${themeClassByTheme[boardTheme]}`}>
      <SamsungDarkModeHelp />
      {error && (
        <div className={styles.errorCard} data-testid="error-card" role="alert">
          <span>
            {aiFailed
              ? t("game.aiStoppedMessage")
              : `${t("game.errorPrefix")}: ${displayedError}`}
          </span>
          {aiFailed && retryAi && (
            <button
              type="button"
              onClick={retryAi}
              disabled={aiRetrying}
              style={{
                minHeight: 44,
                padding: "8px 14px",
                borderRadius: 12,
                background: "#e7bd72",
                color: "#142321",
                pointerEvents: "auto",
                flexShrink: 0,
              }}
            >
              {aiRetrying
                ? t("game.aiRetryingButton")
                : t("game.aiRetryButton")}
            </button>
          )}
          <button
            type="button"
            className={styles.errorCardClose}
            data-testid="error-card-close"
            aria-label={t("game.dismissError")}
            onClick={clearError}
          >
            ✕
          </button>
        </div>
      )}

      {gameResult?.matchOver &&
        (() => {
          const gt = (propGameType ??
            gameResult.gameType ??
            contextGameType ??
            "1v1") as string;
          // Cap only the presentation; keep the authoritative score and game points intact.
          const scoreLimit =
            gt !== "quick" && gameResult.targetPoints > 0
              ? gameResult.targetPoints
              : Infinity;
          const common = {
            roomId,

            winner: gameResult.winner,
            whiteScore: Math.min(gameResult.matchScore.white, scoreLimit),
            blackScore: Math.min(gameResult.matchScore.black, scoreLimit),

            whiteName,
            blackName,
            playerColor,

            winType: gameResult.winType,
            reason: gameResult.reason,

            ratingBefore: gameResult.ratingBefore ?? null,
            ratingAfter: gameResult.ratingAfter ?? null,
            opponentRatingBefore: gameResult.opponentRatingBefore ?? null,
            opponentRatingAfter: gameResult.opponentRatingAfter ?? null,
            ratingChange: gameResult.ratingChange ?? null,
            opponentRatingChange: gameResult.opponentRatingChange ?? null,

            hits: gameResult.hits ?? null,
            durationSeconds: gameResult.durationSeconds ?? null,

            coinsDelta: gameResult.coinsChange ?? null,
            opponentCoinsDelta: gameResult.opponentCoinsChange ?? null,

            onClose: requestLeave,
          };
          if (gt === "tournament") {
            return (
              <TournamentGameResult
                {...common}
                winnerIsWhite={gameResult.winner === "white"}
                tournamentRound={gameResult.tournament?.roundLabel}
                nextOpponent={gameResult.tournament?.nextOpponent ?? null}
                onViewTournament={requestLeave}
                onViewBracket={requestLeave}
              />
            );
          }
          if (gt === "quick") {
            return (
              <QuickGameResult
                {...common}
                onRematch={handleNextGame}
                rematchPending={false}
                onCancelRematch={() => {}}
              />
            );
          }
          return (
            <PrivateGameResult
              {...common}
              onPracticeAgain={onPracticeAgain}
              showRematch={showRematch}
              onRematch={handleNextGame}
            />
          );
        })()}

      {/* Non-final game wins auto-continue; no overlay */}
      {!gameResult?.matchOver && (
        <>
          {reconnected && (
            <div className={styles.reconnected} role="status">
              {t("game.reconnected")}
            </div>
          )}
          {!opponentConnected &&
            !reconnected &&
            !gameResult?.matchOver &&
            !gameHasStarted && (
              <div className={styles.disconnected} role="status">
                {t("game.opponentNotConnected")}
              </div>
            )}
          {!opponentConnected &&
            !reconnected &&
            gameHasStarted &&
            disconnectCountdown !== null &&
            !gameResult?.matchOver && (
              <div className={styles.disconnected} role="status">
                {t("game.opponentDisconnected", {
                  seconds: disconnectCountdown,
                })}
              </div>
            )}

          <GameBoard
            state={state}
            playerColor={playerColor}
            makeMove={makeMove}
            reorderDice={reorderDice}
            undoMove={undoMove}
            endTurn={endTurn}
            offerDouble={offerDouble}
            boardTheme={boardTheme}
            onBoardThemeChange={setBoardTheme}
            needsToRoll={needsToRoll}
            onRoll={handleRoll}
            respondToDouble={respondToDouble}
            onLeave={requestLeave}
            clock={clock}
            turnStartedAt={turnStartedAt}
            timeControl={timeControl}
            noMovesMessage={noMovesMessage}
          />
        </>
      )}

      {isOpeningResult && openingRollResult && (
        <div className={styles.overlayDim}>
          <div
            className={styles.overlayCard}
            data-testid="opening-result-overlay"
          >
            <div style={{ marginBottom: "0.75rem" }}>
              <DiceRow
                dice={[]}
                remaining={[]}
                color={playerColor}
                showLabels
                myRoll={openingRollResult.myDie}
                opponentRoll={openingRollResult.opponentDie}
                winner={openingRollResult.winner}
              />
            </div>
            {openingRollResult.winner === playerColor && (
              <div className={styles.winnerText}>{t("game.youFirst")}</div>
            )}
            {openingRollResult.winner &&
              openingRollResult.winner !== playerColor && (
                <div className={styles.subText}>{t("game.opponentFirst")}</div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
