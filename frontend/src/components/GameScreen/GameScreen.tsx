import { useCallback, useEffect, useState, useRef } from "react";
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import GameResultOverlay from "../GameResultOverlay/GameResultOverlay";
import { DiceRow, RollPrompt } from "../Dice";
import { useAutoRoll } from "../autoRoll/AutoRoll";
import { clientLogger } from "@/services/logger";
import { canOfferDouble } from "@/lib/backgammon/engine";

interface GameScreenProps {
  onLeave?: (outcome?: "won" | "lost") => void;
  homeLabel?: string;
}

export default function GameScreen({ onLeave, homeLabel }: GameScreenProps) {
  const {
    state,
    playerColor,
    isLoading,
    error,
    clearError,
    makeMove,
    rollDice,
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
    handleNextGame,
    handleHome,
  } = useGame();

  const [rollResult, setRollResult] = useState<number[] | undefined>(undefined);
  const [landing, setLanding] = useState(false);
  const [autoRoll, setAutoRoll] = useAutoRoll();
  const DOUBLE_WINDOW_SECONDS = 20;
  const [doubleWindow, setDoubleWindow] = useState(false);
  const [doubleCountdown, setDoubleCountdown] = useState(DOUBLE_WINDOW_SECONDS);
  const [doubleOfferPending, setDoubleOfferPending] = useState(false);
  const doubleDecidedRef = useRef(false);

  const canChooseDouble = Boolean(
    autoRoll &&
      state?.phase === "rolling" &&
      state.remaining.length === 0 &&
      state.turn === playerColor &&
      canOfferDouble(state, playerColor),
  );

  const handleRoll = useCallback(() => {
    setRollResult(undefined);
    setLanding(true);
    rollDice();
  }, [rollDice]);

  useEffect(() => {
    if (!state) return;
    if (!canChooseDouble) {
      doubleDecidedRef.current = false;
      setDoubleWindow(false);
      setDoubleOfferPending(false);
      return;
    }
    if (!doubleDecidedRef.current && !doubleWindow) {
      setDoubleWindow(true);
      setDoubleCountdown(DOUBLE_WINDOW_SECONDS);
    }
  }, [canChooseDouble, doubleWindow]);

  useEffect(() => {
    if (!doubleWindow) return;
    if (doubleCountdown <= 0) {
      doubleDecidedRef.current = true;
      setDoubleWindow(false);
      return;
    }
    const t = setTimeout(() => setDoubleCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [doubleWindow, doubleCountdown]);
  const handleDoubleOffer = useCallback(() => {
    doubleDecidedRef.current = true;
    setDoubleOfferPending(true);
    setDoubleWindow(false);
    offerDouble();
  }, [offerDouble]);

  const handleDoubleSkip = useCallback(() => {
    doubleDecidedRef.current = true;
    setDoubleWindow(false);
  }, []);

  const handleOpeningRoll = useCallback(() => {
    rollDice();
  }, [rollDice]);

  useEffect(() => {
    // Once the server delivers dice during the roll, feed them to the prompt.
    if (landing && state?.phase === "moving" && state.dice.length > 0) {
      setRollResult(state.dice);
    }
  }, [landing, state?.phase, state?.dice]);

  useEffect(() => {
    if (!autoRoll) return;
    if (!state) return;
    if (state.turn !== playerColor) return;
    clientLogger.debug("[autoRoll] effect fired", {
      phase: state.phase,
      turn: state.turn,
      playerColor,
      remaining: state.remaining,
    });
    if (state.phase === "opening_roll") {
      handleOpeningRoll();
    } else if (
      state.phase === "rolling" &&
      state.remaining.length === 0 &&
      !doubleWindow &&
      !doubleOfferPending &&
      (!canChooseDouble || doubleDecidedRef.current)
    ) {
      rollDice();
    }
  }, [
    autoRoll,
    state,
    playerColor,
    handleOpeningRoll,
    rollDice,
    doubleWindow,
    doubleOfferPending,
    canChooseDouble,
  ]);

  const handleRollLand = useCallback(() => {
    setLanding(false);
    setRollResult(undefined);
  }, []);

  const isOpeningRoll = state?.phase === "opening_roll";
  const isOpeningResult = state?.phase === "opening_result";
  const needsToRoll =
    (state?.phase === "rolling" &&
      state?.remaining.length === 0 &&
      state?.turn === playerColor) ||
    (landing && state?.turn === playerColor);

  if (isLoading) {
    return <div className={styles.loading}>Connecting to game...</div>;
  }

  if (!state) {
    if (error) {
      return <div className={styles.error}>Error: {error}</div>;
    }
    return <div className={styles.loading}>Initializing game...</div>;
  }

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorCard} data-testid="error-card" role="alert">
          <span>Error: {error}</span>
          <button
            type="button"
            className={styles.errorCardClose}
            data-testid="error-card-close"
            aria-label="Dismiss error"
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
          {reconnected && <div className={styles.reconnected}>Reconnected</div>}
          {!opponentConnected && !reconnected && (
            <div className={styles.disconnected}>
              Opponent disconnected — you can keep playing
            </div>
          )}

          <GameBoard
            state={state}
            playerColor={playerColor}
            makeMove={makeMove}
            undoMove={undoMove}
            endTurn={endTurn}
            autoRoll={autoRoll}
            onAutoRollChange={setAutoRoll}
            needsToRoll={needsToRoll}
            onRoll={handleRoll}
            rollResult={rollResult}
            onRollLand={handleRollLand}
            landing={landing}
            respondToDouble={respondToDouble}
            onLeave={onLeave}
            clock={clock}
            turnStartedAt={turnStartedAt}
            timeControl={timeControl}
          />
        </>
      )}

      {isOpeningRoll && state.turn === playerColor && !autoRoll && (
        <div className={styles.overlayDim}>
          <div className={styles.overlayCard}>
            <RollPrompt
              onRoll={handleOpeningRoll}
              isOpening
              dark={playerColor === "black"}
            />
          </div>
        </div>
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
              <div className={styles.winnerText}>You go first!</div>
            )}
            {openingRollResult.winner &&
              openingRollResult.winner !== playerColor && (
                <div className={styles.subText}>Opponent goes first</div>
              )}
          </div>
        </div>
      )}

      {doubleWindow && (
        <div className={styles.overlayDim} data-testid="double-decision-overlay">
          <div className={styles.overlayCard} role="dialog" aria-modal="true" aria-label="Double decision">
            <div className={styles.winnerText}>Offer a double before rolling?</div>
            <div className={styles.subText}>Auto roll starts in {doubleCountdown}s</div>
            <div className={styles.doubleDecisionActions}>
              <button type="button" className={styles.doubleOfferButton} onClick={handleDoubleOffer}>
                Offer double
              </button>
              <button type="button" className={styles.doubleSkipButton} onClick={handleDoubleSkip}>
                Roll now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
