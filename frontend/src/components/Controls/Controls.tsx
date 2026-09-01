import styles from "./Controls.module.css";
import { canOfferDouble, type GameState, type Color } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import DoublingCube from "../DoublingCube";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ playerColor, state }: ControlsProps) {
  const { offerDouble } = useGame();
  const canDouble = canOfferDouble(state, playerColor);

  return (
    <div className={styles.controlsContainer}>
      {state.doublingEnabled !== false && <DoublingCube value={state.cube} owner={state.cubeOwner} />}

      {canDouble && (
        <button
          className={`${styles.btn} ${styles.secondary}`}
          onClick={offerDouble}
          title="Offer double to opponent"
        >
          ✕2 Double
        </button>
      )}
    </div>
  );
}
