import { memo, useState } from "react";
import styles from "./SidePanel.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";
import { useI18n } from "../../i18n/I18nProvider";
import BoardThemeSelector from "../BoardThemeSelector/BoardThemeSelector";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";
import { LanguageSwitcher } from "../LanguageSwitcher/LanguageSwitcher";
import InstallAppButton from "../InstallAppButton/InstallAppButton";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  onLeave?: (outcome?: "won" | "lost") => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
  boardTheme?: BoardTheme;
  onBoardThemeChange?: (theme: BoardTheme) => void;
}

function SidePanel({
  state,
  playerColor,
  onLeave,
  clock,
  turnStartedAt,
  timeControl,
  boardTheme,
  onBoardThemeChange,
}: SidePanelProps) {
  const { t } = useI18n();
  const { giveUp, whiteName, blackName, matchScore } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel =
    opponentName || (playerColor === "white" ? t("common.blackPlayer") : t("common.whitePlayer"));
  const selfLabel = selfName
    ? `${selfName} (${t("common.youLower")})`
    : playerColor === "white"
      ? `${t("common.you")} (${t("common.white")})`
      : `${t("common.you")} (${t("common.black")})`;
  const stripMyLabel = selfName || t("common.you");
  const stripOppLabel = opponentName || t("common.opponent");
  const activeColor = activePlayerOf(state);
  const delayMs = timeControl?.delay ?? 0;

  return (
    <div className={styles.panel} data-testid="side-panel">
      <div className={styles.playerSlot}>
        <PlayerRow
          color={opponentColor}
          state={state}
          label={opponentLabel}
          active={activeColor === opponentColor}
          self={false}
          score={matchScore?.[opponentColor] ?? 0}
        />
      </div>

      <div className={styles.clockSlot}>
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

      <button
        type="button"
        className={`${styles.menuButton} ${menuOpen ? styles.menuButtonOpen : ""}`}
        aria-label={t("game.matchControl")}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
        <span />
      </button>

      <div className={styles.playerSlot}>
        <PlayerRow
          color={playerColor}
          state={state}
          label={selfLabel}
          active={activeColor === playerColor}
          self={true}
          score={matchScore?.[playerColor] ?? 0}
        />
      </div>

      {menuOpen && (
        <div className={styles.menuDrawer} data-testid="match-control-drawer">
          <div className={styles.header}>
            <span className={styles.kicker}>{t("game.matchControl")}</span>
            <span className={activeColor === playerColor ? styles.turnSelf : styles.turnOpponent}>
              {activeColor === playerColor ? t("common.yourTurn") : t("common.opponentTurn")}
            </span>
          </div>

          <div className={`${styles.section} ${styles.languageSection}`}>
            <LanguageSwitcher />
            <InstallAppButton />
          </div>

          {boardTheme && onBoardThemeChange && (
            <div className={`${styles.section} ${styles.themeSection}`}>
              <BoardThemeSelector value={boardTheme} onChange={onBoardThemeChange} />
            </div>
          )}
          <div className={styles.actions}>
            {!showGiveUp ? (
              <button
                className={styles.resignBtn}
                onClick={() => setShowGiveUp(true)}
              >
                {t("game.giveUp")}
              </button>
            ) : (
              <div className={styles.resignConfirm}>
                <span className={styles.resignText}>{t("game.sure")}</span>
                <button
                  className={styles.confirmYes}
                  onClick={() => {
                    giveUp();
                    setShowGiveUp(false);
                    setMenuOpen(false);
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
                  setMenuOpen(false);
                }}
                className={styles.leaveBtn}
              >
                {t("common.leave")}
              </button>
            )}
          </div>
        </div>
      )}

      {menuOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label={t("game.dismissError")}
          onClick={() => {
            setMenuOpen(false);
            setShowGiveUp(false);
          }}
        />
      )}
    </div>
  );
}

export default memo(SidePanel);
