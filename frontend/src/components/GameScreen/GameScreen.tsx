import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import ConnectionStatus from "./ConnectionStatus";
import InactivityBanner from "../InactivityBanner";
import TournamentGameResult from "../GameResult/TournamentGameResult";
import QuickGameResult from "../GameResult/QuickGameResult";
import PrivateGameResult from "../GameResult/PrivateGameResult";
import SamsungDarkModeHelp from "../SamsungDarkModeHelp/SamsungDarkModeHelp";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color, GameState } from "../../lib/backgammon/engine";
import { canOfferDouble, isBarEntryFullyBlocked } from "../../lib/backgammon/engine";
import { formatClock } from "../../lib/clock";
import {
  DEFAULT_BOARD_THEME,
  isBoardTheme,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import { boardThemeClasses } from "../BoardThemeSelector/boardThemeClasses";
import { useGameSounds } from "../../hooks/useGameSounds";
import { useAutoRoll } from "../../hooks/useAutoRoll";
import { useStoredPreference } from "../../hooks/useStoredPreference";
import { useTurnRollActions } from "../../hooks/useTurnRollActions";
import {
  DEFAULT_CHECKER_STYLE,
  isCheckerStyle,
  type CheckerStyle,
} from "../Board/materials/checkerStyles";

const BOARD_THEME_STORAGE_KEY = "6b-board-theme";
const CHECKER_STYLE_STORAGE_KEY = "6b-checker-style";

function parseBoardTheme(saved: string | null): BoardTheme {
  return isBoardTheme(saved) ? saved : DEFAULT_BOARD_THEME;
}

function parseCheckerStyle(saved: string | null): CheckerStyle {
  return isCheckerStyle(saved) ? saved : DEFAULT_CHECKER_STYLE;
}

import type { GameType } from "../../types/context";

interface GameScreenProps {
  closeExisting?: boolean;
  onLeave?: (outcome?: "won" | "lost") => void;
  homeLabel?: string;
  restartOnResultClose?: boolean;
  gameType?: GameType;
  showRematch?: boolean;
  onPracticeAgain?: () => void;
  onViewTournament?: () => void;
  onViewBracket?: () => void;
  bracketUrl?: string;
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
  restartOnResultClose = false,
  gameType: propGameType,
  showRematch = true,
  onPracticeAgain,
  onViewTournament,
  onViewBracket,
  bracketUrl,
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
    connectionEpoch,
    entryPending,
    adminReviewPending,
    opponentConnected,
    opponentEntryDeadline,
    undoMove,
    autoConfirmPending,
    hasPendingMoves,
    endTurn,
    respondToDouble,
    offerDouble,
    clock,
    turnStartedAt,
    timeControl,
    gameResult,
    matchScore,
    targetPoints,
    whiteName,
    blackName,
    noMovesMessage,
    handleHome,
    leaveGame,
    rematchState,
    rematchReady,
    requestRematch,
    acceptRematch,
    declineRematch,
    cancelRematch,
    gameType: contextGameType,
  } = useGame();
  const matchFinished = gameResult?.matchOver === true;
  const setBoardSurface = useCallback((element: HTMLDivElement | null) => {
    if (element) element.inert = matchFinished;
  }, [matchFinished]);
  const { soundEnabled, setSoundEnabled, playActionSound } = useGameSounds(state, roomId, {
    playerColor, matchScore, isLoading, reconnected, connectionEpoch,
  });
  const [autoRoll, setAutoRoll] = useAutoRoll();
  const handleUndo = useCallback(() => {
    playActionSound("undo");
    undoMove();
  }, [playActionSound, undoMove]);
  const handleConfirm = useCallback(() => {
    playActionSound("confirm");
    endTurn();
  }, [playActionSound, endTurn]);
  const displayedError = (() => {
    switch (error) {
      case "tournament_entry_clock_expired":
        return t("game.tournamentEntryClockExpired");

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

      case "Cube is dead for this player":
        return t("game.deadCube");

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

  const [boardTheme, setBoardTheme] = useStoredPreference(
    BOARD_THEME_STORAGE_KEY, DEFAULT_BOARD_THEME, parseBoardTheme,
  );
  const [checkerStyle, setCheckerStyle] = useStoredPreference(
    CHECKER_STYLE_STORAGE_KEY, DEFAULT_CHECKER_STYLE, parseCheckerStyle,
  );
  const [connectionCountdown, setConnectionCountdown] = useState<{
    firstEntryDeadline: number | null;
    seconds: number;
  } | null>(null);
  const automaticOpeningRollRef = useRef<string | null>(null);
  const rematchNavigationRef = useRef<string | null>(null);
  const gameHasStarted =
    state?.phase === "rolling" ||
    state?.phase === "moving" ||
    state?.phase === "doubling_offered";
  const firstEntryDeadline = !opponentConnected && opponentEntryDeadline != null
    ? opponentEntryDeadline * 1000 : null;
  const secondsToConnect = connectionCountdown?.firstEntryDeadline === firstEntryDeadline
    ? connectionCountdown.seconds : null;

  // Display the server's first-entry deadline or the existing reconnect estimate.
  // The server decides the result in either case.
  useEffect(() => {
    if (
      opponentConnected ||
      adminReviewPending ||
      gameResult?.matchOver ||
      (firstEntryDeadline === null && (reconnected || !gameHasStarted))
    ) {
      const resetTimer = window.setTimeout(() => {
        setConnectionCountdown(null);
      }, 0);

      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    const deadline = firstEntryDeadline ?? Date.now() + 40_000;

    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setConnectionCountdown((previous) =>
        previous?.firstEntryDeadline === firstEntryDeadline && previous.seconds === seconds
          ? previous : { firstEntryDeadline, seconds },
      );
    };

    const initialTimer = window.setTimeout(updateCountdown, 0);
    const interval = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [adminReviewPending, firstEntryDeadline, gameHasStarted, gameResult?.matchOver, opponentConnected, reconnected]);

  const interruptedOpeningMove = hasInterruptedOpeningMove(state, playerColor);
  const interruptedOpeningMoveKey =
    interruptedOpeningMove && state
      ? `resume:${state.openingRoll.white}:${state.openingRoll.black}`
      : null;
  const waitingForOpeningRoll =
    state?.phase === "opening_roll" &&
    state.turn === playerColor &&
    state.openingRoll[playerColor] === null;
  const openingRollKey =
    interruptedOpeningMoveKey ??
    (waitingForOpeningRoll
      ? `${state.turn}:${state.openingRoll.white ?? "-"}:${state.openingRoll.black ?? "-"}`
      : null);
  const automaticOpeningRollKey = entryPending || adminReviewPending || !openingRollKey
    ? null
    : entryPending === undefined
      ? openingRollKey
      : `${connectionEpoch ?? 0}:${openingRollKey}`;

  useEffect(() => {
    if (!automaticOpeningRollKey) {
      automaticOpeningRollRef.current = null;
      return;
    }
    if (automaticOpeningRollRef.current === automaticOpeningRollKey) return;
    automaticOpeningRollRef.current = automaticOpeningRollKey;
    rollDice();
  }, [automaticOpeningRollKey, rollDice]);

  useEffect(() => {
    if (!rematchReady) return;
    if (
      typeof rematchReady.ticket === "string" &&
      rematchReady.ticket.length > 0
    ) {
      const key = `ticket:${rematchReady.ticket}`;
      if (rematchNavigationRef.current === key) return;
      rematchNavigationRef.current = key;
      const entry = new URL(
        "/backgammon/api/link/enter/",
        window.location.origin,
      );
      entry.searchParams.set("ticket", rematchReady.ticket);
      window.location.assign(entry.toString());
      return;
    }
    if (
      typeof rematchReady.roomId === "string" &&
      rematchReady.roomId.length > 0 &&
      (rematchReady.color === "white" || rematchReady.color === "black")
    ) {
      const key = `room:${rematchReady.roomId}:${rematchReady.color}`;
      if (rematchNavigationRef.current === key) return;
      rematchNavigationRef.current = key;
      window.location.assign(
        `${import.meta.env.BASE_URL}game/${encodeURIComponent(rematchReady.roomId)}?color=${rematchReady.color}`,
      );
    }
  }, [rematchReady]);

  const needsToRoll =
    !gameResult &&
    !adminReviewPending &&
    state?.phase === "rolling" &&
    !interruptedOpeningMove &&
    state.remaining.length === 0 &&
    state.turn === playerColor;
  const regularRollKey = needsToRoll
    ? `${roomId ?? "local"}:${playerColor}:${state?.version ?? 0}:${turnStartedAt ?? 0}`
    : null;
  const timedTournament = (propGameType ?? contextGameType) === "tournament" && Boolean(timeControl);
  const rollPaused = isLoading || showCloseExisting ||
    (!opponentConnected && !timedTournament && firstEntryDeadline === null) ||
    Boolean(gameResult) || adminReviewPending === true;
  const blockedOnBar = Boolean(state && isBarEntryFullyBlocked(state, playerColor));

  const { handleRoll, handleOfferDouble, countdownSeconds } = useTurnRollActions({
    turnKey: regularRollKey,
    autoRoll,
    canDouble: Boolean(state && canOfferDouble(state, playerColor, { targetPoints, matchScore })),
    blockedOnBar,
    paused: rollPaused,
    hasError: Boolean(error),
    rollDice,
    offerDouble,
  });

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
    <div className={`${styles.container} ${boardThemeClasses[boardTheme]} bg-[#050c0e]`}>
      {!matchFinished && <SamsungDarkModeHelp />}
      {!matchFinished && error && (
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
                onViewTournament={onViewTournament ?? requestLeave}
                onViewBracket={onViewBracket ?? requestLeave}
              />
            );
          }
          if (gt === "quick") {
            return (
              <QuickGameResult
                {...common}
                rematchStatus={rematchState?.status ?? null}
                rematchReason={rematchState?.reason}
                rematchReady={rematchReady != null}
                onRematch={requestRematch ?? (() => {})}
                onAcceptRematch={acceptRematch}
                onDeclineRematch={declineRematch}
                onCancelRematch={cancelRematch}
              />
            );
          }
          return (
            <PrivateGameResult
              {...common}
              onPracticeAgain={onPracticeAgain}
              restartOnClose={restartOnResultClose}
              showRematch={showRematch}
              rematchStatus={rematchState?.status ?? null}
              rematchReason={rematchState?.reason}
              rematchReady={rematchReady != null}
              onRematch={requestRematch ?? (() => {})}
              onAcceptRematch={acceptRematch}
              onDeclineRematch={declineRematch}
              onCancelRematch={cancelRematch}
            />
          );
        })()}

      {/* Non-final game wins auto-continue; no overlay */}
      {!matchFinished && (
        adminReviewPending ? (
          <ConnectionStatus connected={false} text={t("game.adminReviewPending")} />
        ) : <>
          {firstEntryDeadline !== null ? (
            <ConnectionStatus connected={false} text={secondsToConnect === null
              ? t("game.opponentNotConnected")
              : t("game.waitingForTournamentEntry", { time: formatClock(secondsToConnect * 1000) })} />
          ) : reconnected ? (
            <ConnectionStatus connected text={t("game.reconnected")} />
          ) : !opponentConnected && !gameHasStarted ? (
            <ConnectionStatus connected={false} text={t("game.opponentNotConnected")} />
          ) : !opponentConnected && secondsToConnect !== null ? (
            <ConnectionStatus connected={false} text={t("game.opponentDisconnected", { seconds: secondsToConnect })} />
          ) : null}
          <InactivityBanner state={state} playerColor={playerColor} />
        </>
      )}
      <div className="contents" ref={setBoardSurface}>
        <GameBoard
          state={state}
          readOnly={matchFinished}
          recoveringOpening={interruptedOpeningMove}
          noticeScope={roomId ?? "local"}
          match={{ targetPoints, matchScore }}
          playerColor={playerColor}
          makeMove={makeMove}
          reorderDice={reorderDice}
          undoMove={handleUndo}
          autoConfirmPending={autoConfirmPending}
          hasPendingMoves={hasPendingMoves}
          endTurn={handleConfirm}
          offerDouble={handleOfferDouble}
          boardTheme={boardTheme}
          onBoardThemeChange={setBoardTheme}
          checkerStyle={checkerStyle}
          onCheckerStyleChange={setCheckerStyle}
          soundEnabled={soundEnabled}
          onSoundEnabledChange={setSoundEnabled}
          autoRoll={autoRoll}
          autoRollCountdown={countdownSeconds}
          onAutoRollChange={setAutoRoll}
          needsToRoll={needsToRoll}
          onRoll={handleRoll}
          respondToDouble={respondToDouble}
          onLeave={requestLeave}
          clock={clock}
          turnStartedAt={turnStartedAt}
          timeControl={timeControl}
          noMovesMessage={matchFinished || adminReviewPending ? null : noMovesMessage}
          bracketUrl={bracketUrl}
        />
      </div>

    </div>
  );
}
