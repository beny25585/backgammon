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
  onLeave?: (outcome?: "won" | "lost") => void;
  homeLabel?: string;
  gameType?: GameType;
  showRematch?: boolean;
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
  onLeave,
  homeLabel,
  gameType: propGameType,
  showRematch = true,
}: GameScreenProps) {
  const { t } = useI18n();
  const {
    state,
    roomId,
    playerColor,
    isLoading,
    error,
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

  const leavingRef = useRef(false);
  const requestLeave = useCallback(() => {
    if (gameResult?.matchOver) {
      if (onLeave) onLeave(gameResult.winner === playerColor ? "won" : "lost");
      else handleHome();
      return;
    }
    leavingRef.current = true;
    leaveGame();
  }, [gameResult, onLeave, playerColor, handleHome, leaveGame]);

  useEffect(() => {
    if (!leavingRef.current || !gameResult?.matchOver) return;
    leavingRef.current = false;
    if (onLeave) onLeave(gameResult.winner === playerColor ? "won" : "lost");
    else handleHome();
  }, [gameResult, onLeave, playerColor, handleHome]);

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

  if (isLoading) {
    return <div className={styles.loading}>{t("game.connecting")}</div>;
  }

  if (!state) {
    if (error) {
      return (
        <div className={styles.error}>
          {t("game.errorPrefix")}: {error}
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
            {t("game.errorPrefix")}: {error}
          </span>
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
          const common = {
            coinsDelta: gameResult.coinsChange,
            opponentCoinsDelta: gameResult.opponentCoinsChange,
            roomId,
            playerColor,
            winner: gameResult.winner,
            whiteScore: gameResult.matchScore.white,
            blackScore: gameResult.matchScore.black,
            whiteName,
            blackName,
            winType: gameResult.winType,
            reason: gameResult.reason,
            onClose: requestLeave,
          };
          if (gt === "tournament") {
            return (
              <TournamentGameResult
                {...common}
                winnerIsWhite={gameResult.winner === "white"}
                tournamentRound={gameResult.tournament?.roundLabel}
                nextOpponent={gameResult.tournament?.nextOpponent ?? null}
                ratingBefore={gameResult.ratingBefore ?? null}
                ratingAfter={gameResult.ratingAfter ?? null}
                opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
                opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
                ratingChange={gameResult.ratingChange ?? null}
                opponentRatingChange={gameResult.opponentRatingChange ?? null}
                hits={gameResult.hits ?? null}
                doublesOffered={gameResult.doublesOffered ?? null}
                doublesAccepted={gameResult.doublesAccepted ?? null}
                openingRoll={gameResult.openingRoll ?? null}
                firstPlayer={gameResult.firstPlayer ?? null}
                durationSeconds={gameResult.durationSeconds ?? null}
                clockRemaining={gameResult.clockRemaining ?? null}
                onViewTournament={requestLeave}
                onViewBracket={requestLeave}
              />
            );
          }
          if (gt === "quick") {
            return (
              <QuickGameResult
                {...common}
                cube={gameResult.cube}
                stakeAmount={gameResult.stakeAmount ?? null}
                ratingBefore={gameResult.ratingBefore ?? null}
                ratingAfter={gameResult.ratingAfter ?? null}
                opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
                opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
                ratingChange={gameResult.ratingChange ?? null}
                opponentRatingChange={gameResult.opponentRatingChange ?? null}
                hits={gameResult.hits ?? null}
                doublesOffered={gameResult.doublesOffered ?? null}
                doublesAccepted={gameResult.doublesAccepted ?? null}
                openingRoll={gameResult.openingRoll ?? null}
                firstPlayer={gameResult.firstPlayer ?? null}
                durationSeconds={gameResult.durationSeconds ?? null}
                clockRemaining={gameResult.clockRemaining ?? null}
                coinsDelta={gameResult.coinsChange ?? null}
                opponentCoinsDelta={gameResult.opponentCoinsChange ?? null}
                onRematch={handleNextGame}
                rematchPending={false}
                onCancelRematch={() => {}}
              />
            );
          }
          return (
            <PrivateGameResult
              showRematch={showRematch}
              {...common}
              cube={gameResult.cube}
              ratingBefore={gameResult.ratingBefore ?? null}
              ratingAfter={gameResult.ratingAfter ?? null}
              opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
              opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
              ratingChange={gameResult.ratingChange ?? null}
              opponentRatingChange={gameResult.opponentRatingChange ?? null}
              hits={gameResult.hits ?? null}
              doublesOffered={gameResult.doublesOffered ?? null}
              doublesAccepted={gameResult.doublesAccepted ?? null}
              openingRoll={gameResult.openingRoll ?? null}
              firstPlayer={gameResult.firstPlayer ?? null}
              durationSeconds={gameResult.durationSeconds ?? null}
              clockRemaining={gameResult.clockRemaining ?? null}
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
          {!opponentConnected && !reconnected && (
            <div className={styles.disconnected} role="status">
              {t("game.opponentDisconnected", {
                seconds: disconnectCountdown ?? 40,
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
