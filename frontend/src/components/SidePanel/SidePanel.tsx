import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SidePanel.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Controls from "../Controls";
import { useGame } from "../../services/gameContext";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  onLeave?: () => void;
}

export default function SidePanel({ state, playerColor, onLeave }: SidePanelProps) {
  const navigate = useNavigate();
  const { giveUp, whiteName, blackName } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || (playerColor === "white" ? "Black Player" : "White Player");
  const selfLabel = selfName ? `${selfName} (you)` : (playerColor === "white" ? "You (White)" : "You (Black)");;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <PlayerRow
          color={opponentColor}
          state={state}
          label={opponentLabel}
          active={state.turn === opponentColor}
          self={false}
        />
      </div>

      <div className={styles.section}>
        <PlayerRow
          color={playerColor}
          state={state}
          label={selfLabel}
          active={state.turn === playerColor}
          self={true}
        />
      </div>

      <div className={styles.section}>
        <Controls playerColor={playerColor} state={state} />
      </div>

      <div className={styles.actions}>
        {!showGiveUp ? (
          <button
            className={styles.resignBtn}
            onClick={() => setShowGiveUp(true)}
          >
            Give Up
          </button>
        ) : (
          <div className={styles.resignConfirm}>
            <span className={styles.resignText}>Sure?</span>
            <button
              className={styles.confirmYes}
              onClick={() => {
                giveUp();
                setShowGiveUp(false);
                navigate("/home");
              }}
            >
              Yes
            </button>
            <button
              className={styles.confirmNo}
              onClick={() => setShowGiveUp(false)}
            >
              No
            </button>
          </div>
        )}

        {onLeave && (
          <button onClick={onLeave} className={styles.leaveBtn}>
            Leave
          </button>
        )}
      </div>
    </div>
  );
}
