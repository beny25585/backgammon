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
import type { GameType } from "../../types/context";

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
  if (!state || state.phase !== "rolling" || state.turn !== playerColor) {
    return false;
  }

  const { white, black } = state.openingRoll;

  if (white === null || black === null || white === black) {
    return false;
  }

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
    autoConfirmPending,

    handleHome,
    leaveGame,

    rematchState,
    requestRematch,
    acceptRematch,
    declineRematch,
    cancelRematch,

    gameType: contextGameType,
  } = useGame();

  const leavingRef = useRef(false);

  const closeFinalResult = useCallback(() => {
    if (!gameResult?.matchOver) {
      return;
    }

    if (onLeave) {
      onLeave(gameResult.winner === playerColor ? "won" : "lost");
    } else {
      handleHome();
    }
  }, [gameResult, onLeave, playerColor, handleHome]);

  const requestLeave = useCallback(() => {
    if (gameResult?.matchOver) {
      closeFinalResult();
      return;
    }

    leavingRef.current = true;
    leaveGame();
  }, [gameResult, closeFinalResult, leaveGame]);

  useEffect(() => {
    if (!leavingRef.current || !gameResult?.matchOver) {
      return;
    }

    leavingRef.current = false;

    if (onLeave) {
      onLeave(gameResult.winner === playerColor ? "won" : "lost");
    } else {
      handleHome();
    }
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

  /*
   * The server decides the forfeit.
   *
   * This countdown only makes its reconnect grace period
   * visible to the player who remains in the room.
   * Only after gameHasStarted does the 40s forfeit apply.
   */
  useEffect(() => {
    if (
      opponentConnected ||
      reconnected ||
      gameResult?.matchOver ||
      !gameHasStarted
    ) {
      const resetTimer = window.setTimeout(() => {
        setDisconnectCountdown(null);
      }, 0);

      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    const deadline = Date.now() + 40_000;

    const updateCountdown = () => {
      setDisconnectCountdown(
        Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      );
    };

    const initialTimer = window.setTimeout(updateCountdown, 0);
    const interval = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
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

    if (automaticOpeningRollRef.current === automaticOpeningRollKey) {
      return;
    }

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

      {/* GLOBAL GAME ERROR */}
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

      {/* FINAL MATCH RESULT */}
      {gameResult?.matchOver &&
        (() => {
          /*
           * The actual result type must win over the route/default prop.
           *
           * Example:
           *
           * propGameType     = "1v1"
           * gameResult.type  = "quick"
           * contextGameType  = "quick"
           *
           * This must render QuickGameResult.
           */
          const gt = (gameResult.gameType ??
            contextGameType ??
            propGameType ??
            "1v1") as string;

          const targetPoints = Number(gameResult.targetPoints ?? 0);

          const shouldCapDisplayedScore =
            gt !== "quick" &&
            Number.isFinite(targetPoints) &&
            targetPoints > 0;

          const displayWhiteScore = shouldCapDisplayedScore
            ? Math.min(gameResult.matchScore.white, targetPoints)
            : gameResult.matchScore.white;

          const displayBlackScore = shouldCapDisplayedScore
            ? Math.min(gameResult.matchScore.black, targetPoints)
            : gameResult.matchScore.black;

          const common = {
            winner: gameResult.winner,

            whiteScore: displayWhiteScore,

            blackScore: displayBlackScore,

            whiteName,
            blackName,

            winType: gameResult.winType,

            reason: gameResult.reason,

            onClose: closeFinalResult,
          };

          /*
           * TOURNAMENT RESULT
           */
          if (gt === "tournament") {
            return (
              <TournamentGameResult
                {...common}
                playerColor={playerColor}
                winnerIsWhite={gameResult.winner === "white"}
                tournamentRound={gameResult.tournament?.roundLabel}
                nextOpponent={gameResult.tournament?.nextOpponent ?? null}
                ratingBefore={gameResult.ratingBefore ?? null}
                ratingAfter={gameResult.ratingAfter ?? null}
                opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
                opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
                ratingChange={gameResult.ratingChange ?? null}
                opponentRatingChange={gameResult.opponentRatingChange ?? null}
                doublesOffered={gameResult.doublesOffered ?? null}
                doublesAccepted={gameResult.doublesAccepted ?? null}
                openingRoll={gameResult.openingRoll ?? null}
                firstPlayer={gameResult.firstPlayer ?? null}
                durationSeconds={gameResult.durationSeconds ?? null}
                clockRemaining={gameResult.clockRemaining ?? null}
                onViewTournament={closeFinalResult}
                onViewBracket={closeFinalResult}
              />
            );
          }

          if (gt === "quick") {
            console.log(
              "[QUICK RESULT DATA]",
              JSON.stringify(
                {
                  winner: gameResult.winner,
                  playerColor,

                  whiteName,
                  blackName,

                  matchScore: gameResult.matchScore,

                  cube: gameResult.cube,
                  stakeAmount: gameResult.stakeAmount,

                  ratingBefore: gameResult.ratingBefore,
                  ratingAfter: gameResult.ratingAfter,

                  opponentRatingBefore: gameResult.opponentRatingBefore,
                  opponentRatingAfter: gameResult.opponentRatingAfter,

                  ratingChange: gameResult.ratingChange,
                  opponentRatingChange: gameResult.opponentRatingChange,

                  coinsChange: gameResult.coinsChange,
                  opponentCoinsChange: gameResult.opponentCoinsChange,

                  hits: gameResult.hits,
                  doublesOffered: gameResult.doublesOffered,
                  doublesAccepted: gameResult.doublesAccepted,

                  openingRoll: gameResult.openingRoll,
                  firstPlayer: gameResult.firstPlayer,

                  durationSeconds: gameResult.durationSeconds,
                  clockRemaining: gameResult.clockRemaining,
                },
                null,
                2,
              ),
            );
            const quickRematchPending =
              rematchState.status === "requested" || rematchState.status === "creating";
            const quickOffered = rematchState.status === "offered";
            return (
              <QuickGameResult
                {...common}
                playerColor={playerColor}
                cube={gameResult.cube}
                stakeAmount={gameResult.stakeAmount ?? null}
                ratingBefore={gameResult.ratingBefore ?? null}
                ratingAfter={gameResult.ratingAfter ?? null}
                opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
                opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
                ratingChange={gameResult.ratingChange ?? null}
                opponentRatingChange={gameResult.opponentRatingChange ?? null}
                doublesOffered={gameResult.doublesOffered ?? null}
                doublesAccepted={gameResult.doublesAccepted ?? null}
                openingRoll={gameResult.openingRoll ?? null}
                firstPlayer={gameResult.firstPlayer ?? null}
                durationSeconds={gameResult.durationSeconds ?? null}
                clockRemaining={gameResult.clockRemaining ?? null}
                coinsDelta={gameResult.coinsChange ?? null}
                opponentCoinsDelta={gameResult.opponentCoinsChange ?? null}
                onRematch={quickOffered ? acceptRematch : requestRematch}
                rematchPending={quickRematchPending}
                onCancelRematch={quickOffered ? declineRematch : cancelRematch}
                rematchState={rematchState}
              />
            );
          }

          /*
            * PRIVATE / NORMAL 1V1 RESULT
            */
          // Tournament results must not expose arbitrary rematch
          const isTournamentResult = (gameResult.gameType ?? contextGameType) === "tournament";
          if (isTournamentResult) {
            return (
              <PrivateGameResult
                {...common}
                playerColor={playerColor}
                showRematch={false}
                closeLabel={homeLabel}
                cube={gameResult.cube}
                ratingBefore={gameResult.ratingBefore ?? null}
                ratingAfter={gameResult.ratingAfter ?? null}
                opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
                opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
                ratingChange={gameResult.ratingChange ?? null}
                opponentRatingChange={gameResult.opponentRatingChange ?? null}
                doublesOffered={gameResult.doublesOffered ?? null}
                doublesAccepted={gameResult.doublesAccepted ?? null}
                openingRoll={gameResult.openingRoll ?? null}
                firstPlayer={gameResult.firstPlayer ?? null}
                durationSeconds={gameResult.durationSeconds ?? null}
                clockRemaining={gameResult.clockRemaining ?? null}
                onRematch={() => {}}
                rematchState={{ status: "unavailable", reason: "tournament" }}
              />
            );
          }
          const privateOffered = rematchState.status === "offered";
          const privatePending =
            rematchState.status === "requested" || rematchState.status === "creating";
          return (
            <PrivateGameResult
              {...common}
              playerColor={playerColor}
              showRematch={showRematch}
              closeLabel={homeLabel}
              cube={gameResult.cube}
              ratingBefore={gameResult.ratingBefore ?? null}
              ratingAfter={gameResult.ratingAfter ?? null}
              opponentRatingBefore={gameResult.opponentRatingBefore ?? null}
              opponentRatingAfter={gameResult.opponentRatingAfter ?? null}
              ratingChange={gameResult.ratingChange ?? null}
              opponentRatingChange={gameResult.opponentRatingChange ?? null}
              doublesOffered={gameResult.doublesOffered ?? null}
              doublesAccepted={gameResult.doublesAccepted ?? null}
              openingRoll={gameResult.openingRoll ?? null}
              firstPlayer={gameResult.firstPlayer ?? null}
              durationSeconds={gameResult.durationSeconds ?? null}
              clockRemaining={gameResult.clockRemaining ?? null}
              onRematch={privateOffered ? acceptRematch : requestRematch}
              rematchPending={privatePending}
              onCancelRematch={privateOffered ? declineRematch : cancelRematch}
              rematchState={rematchState}
            />
          );
        })()}

      {/*
       * Non-final game wins automatically continue.
       * No final-result overlay is shown here.
       */}
      {!gameResult?.matchOver && (
        <>
          {reconnected && (
            <div className={styles.reconnected} role="status">
              {t("game.reconnected")}
            </div>
          )}

          {!opponentConnected &&
            !reconnected &&
            !gameHasStarted &&
            !gameResult?.matchOver && (
              <div className={styles.disconnected} role="status">
                {t("game.opponentNotConnected")}
              </div>
            )}

          {!opponentConnected &&
            !reconnected &&
            gameHasStarted &&
            !gameResult?.matchOver && (
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
            autoConfirmPending={autoConfirmPending}
          />
        </>
      )}

      {/* OPENING ROLL RESULT */}
      {isOpeningResult && openingRollResult && (
        <div className={styles.overlayDim}>
          <div
            className={styles.overlayCard}
            data-testid="opening-result-overlay"
          >
            <div
              style={{
                marginBottom: "0.75rem",
              }}
            >
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
