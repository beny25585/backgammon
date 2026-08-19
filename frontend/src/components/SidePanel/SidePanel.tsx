import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SidePanel.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Controls from "../Controls";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  onLeave?: () => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
}

export default function SidePanel({ state, playerColor, onLeave, clock, turnStartedAt, timeControl }: SidePanelProps) {
  const navigate = useNavigate();
  const { giveUp, leaveGame, whiteName, blackName, matchScore } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || (playerColor === "white" ? "Black Player" : "White Player");
  const selfLabel = selfName ? `${selfName} (you)` : (playerColor === "white" ? "You (White)" : "You (Black)");;
  const stripMyLabel = selfName || "You";
  const stripOppLabel = opponentName || "Opponent";
  const activeColor = activePlayerOf(state);
  const delayMs = timeControl?.delay ?? 0;

  return (
    <div className={styles.panel} data-testid="side-panel">
      <div className={styles.playersRow}>
        <div className={styles.section}>
        <PlayerRow
          color={opponentColor}
          state={state}
          label={opponentLabel}
          active={activeColor === opponentColor}
          self={false}
          score={matchScore?.[opponentColor] ?? 0}
        />
      </div>

      <div className={styles.section}>
        <PlayerRow
          color={playerColor}
          state={state}
          label={selfLabel}
          active={activeColor === playerColor}
          self={true}
          score={matchScore?.[playerColor] ?? 0}
        />
      </div>
      </div>
      

      <div className={styles.section}>
        <Clock
          clock={clock}
          activeColor={activeColor}
          myColor={playerColor}
          myLabel={stripMyLabel}
          oppLabel={stripOppLabel}
          delayMs={delayMs}
          turnStartedAt={turnStartedAt}
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
          <button
            onClick={() => {
              leaveGame();
              onLeave();
            }}
            className={styles.leaveBtn}
          >
            Leave
          </button>
        )}
      </div>
    </div>
  );
}
