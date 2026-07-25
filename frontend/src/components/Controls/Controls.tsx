import styles from "./Controls.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import DoublingCube from "../DoublingCube";
import { DiceRow } from "../Dice";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ playerColor, state }: ControlsProps) {
  const { offerDouble, respondToDouble } = useGame();
  const isPlayerTurn = state.turn === playerColor;
  const canDouble =
    state.phase === "rolling" && isPlayerTurn;

  return (
    <div className={styles.controlsContainer}>
      <div className={styles.cubeSection}>
        <DoublingCube value={state.cube} owner={state.cubeOwner} />
      </div>

      <div className={styles.actionsSection}>

        {canDouble && (
          <button
            className={`${styles.btn} ${styles.secondary}`}
            onClick={offerDouble}
            title="Offer double to opponent"
          >
            ✕2 Double
          </button>
        )}

        {/* Compact dice during play */}
        {state.phase === "moving" && isPlayerTurn && state.remaining.length > 0 && (
          <DiceRow dice={state.dice} remaining={state.remaining} color={playerColor} />
        )}

        {state.phase === "doubling_offered" && !isPlayerTurn && (
          <div className={styles.doublePrompt}>
            <span>Opponent offers double!</span>
            <button
              className={`${styles.btn} ${styles.accept}`}
              onClick={() => respondToDouble(true)}
            >
              Accept
            </button>
            <button
              className={`${styles.btn} ${styles.reject}`}
              onClick={() => respondToDouble(false)}
            >
              Decline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
