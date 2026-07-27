import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SidePanel.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import OpponentBar from "../OpponentBar";
import TurnIndicator from "../TurnIndicator";
import Controls from "../Controls";
import { useGame } from "../../services/gameContext";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  onLeave?: () => void;
}

export default function SidePanel({ state, playerColor, onLeave }: SidePanelProps) {
  const navigate = useNavigate();
  const { giveUp } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";

  return (
    <div className={styles.panel}>
      <div className={styles.matchInfo}>
        <OpponentBar color={opponentColor} state={state} />
      </div>

      <div className={styles.section}>
        <TurnIndicator currentTurn={state.turn} playerColor={playerColor} />
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
