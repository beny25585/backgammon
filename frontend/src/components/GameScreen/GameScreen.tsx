import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import GameResultOverlay from "../GameResultOverlay/GameResultOverlay";
import { DiceRow } from "../Dice";
import { useI18n } from "../../i18n/I18nProvider";
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
}

export default function GameScreen({ onLeave, homeLabel }: GameScreenProps) {
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
    handleNextGame,
    handleHome,
  } = useGame();

  const [boardTheme, setBoardTheme] = useState<BoardTheme>(initialBoardTheme);
  const automaticOpeningRollRef = useRef<string | null>(null);

  const handleRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  useEffect(() => {
    window.localStorage.setItem(BOARD_THEME_STORAGE_KEY, boardTheme);
  }, [boardTheme]);

  const automaticOpeningRollKey =
    state?.phase === "opening_roll" &&
    state.turn === playerColor &&
    state.openingRoll[playerColor] === null
      ? `${state.turn}:${state.openingRoll.white ?? "-"}:${state.openingRoll.black ?? "-"}`
      : null;

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
    !noMovesMessage &&
    state?.phase === "rolling" &&
    state.remaining.length === 0 &&
    state.turn === playerColor;

  if (isLoading) {
    return <div className={styles.loading}>{t("game.connecting")}</div>;
  }

  if (!state) {
    if (error) {
      return <div className={styles.error}>{t("game.errorPrefix")}: {error}</div>;
    }
    return <div className={styles.loading}>{t("game.initializing")}</div>;
  }

  return (
    <div className={`${styles.container} ${themeClassByTheme[boardTheme]}`}>
      {error && (
        <div className={styles.errorCard} data-testid="error-card" role="alert">
          <span>{t("game.errorPrefix")}: {error}</span>
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

      {gameResult && (
        <GameResultOverlay
          playerColor={playerColor}
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={gameResult.matchScore}
          matchTarget={gameResult.targetPoints}
          matchOver={gameResult.matchOver}
          reason={gameResult.reason}
          whiteName={whiteName}
          blackName={blackName}
          onNext={handleNextGame}
          onHome={() => {
            if (!onLeave) {
              handleHome();
              return;
            }
            onLeave(gameResult.winner === playerColor ? "won" : "lost");
          }}
          homeLabel={homeLabel}
        />
      )}

      {!gameResult && (
        <>
          {reconnected && <div className={styles.reconnected}>{t("game.reconnected")}</div>}
          {!opponentConnected && !reconnected && (
            <div className={styles.disconnected}>
              {t("game.opponentDisconnected")}
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
            onLeave={onLeave}
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
