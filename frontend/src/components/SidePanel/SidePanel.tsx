import { useState } from "react";
import styles from "./SidePanel.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Controls from "../Controls";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";
import { AutoRoll } from "../autoRoll/AutoRoll";
import { useI18n } from "../../i18n/I18nProvider";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  onLeave?: (outcome?: "won" | "lost") => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
  autoRoll?: boolean;
  onAutoRollChange?: (value: boolean) => void;
}

export default function SidePanel({
  state,
  playerColor,
  onLeave,
  clock,
  turnStartedAt,
  timeControl,
  autoRoll,
  onAutoRollChange,
}: SidePanelProps) {
  const { t } = useI18n();
  const { giveUp, whiteName, blackName, matchScore } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel =
    opponentName || (playerColor === "white" ? t("common.blackPlayer") : t("common.whitePlayer"));
  const selfLabel = selfName
    ? `${selfName} (${t("common.you")})`
    : playerColor === "white"
      ? t("common.youColor", { color: t("common.white") })
      : t("common.youColor", { color: t("common.black") });
  const stripMyLabel = selfName || t("common.you");
  const stripOppLabel = opponentName || t("common.opponent");
  const activeColor = activePlayerOf(state);
  const delayMs = timeControl?.delay ?? 0;

  return (
    <div className={styles.panel} data-testid="side-panel">
      <div className={styles.header}>
        <span className={styles.kicker}>{t("game.matchControl")}</span>
        <span className={activeColor === playerColor ? styles.turnSelf : styles.turnOpponent}>
          {activeColor === playerColor ? t("common.yourTurn") : t("common.opponentTurn")}
        </span>
      </div>
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
      <div className={styles.section}>
        {onAutoRollChange && (
          <AutoRoll autoRoll={!!autoRoll} onChange={onAutoRollChange} />
        )}
      </div>

      <div className={styles.actions}>
        {!showGiveUp ? (
          <button
            className={styles.resignBtn}
            onClick={() => setShowGiveUp(true)}
          >
            {t("common.giveUp")}
          </button>
        ) : (
          <div className={styles.resignConfirm}>
            <span className={styles.resignText}>{t("game.sure")}</span>
            <button
              className={styles.confirmYes}
              onClick={() => {
                giveUp();
                setShowGiveUp(false);
              }}
            >
              {t("common.yes")}
            </button>
            <button
              className={styles.confirmNo}
              onClick={() => setShowGiveUp(false)}
            >
              {t("common.no")}
            </button>
          </div>
        )}

        {onLeave && (
          <button
            onClick={() => {
              onLeave();
            }}
            className={styles.leaveBtn}
          >
            {t("common.leave")}
          </button>
        )}
      </div>
    </div>
  );
}
