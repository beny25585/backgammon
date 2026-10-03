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
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
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
  soundEnabled,
  onSoundEnabledChange,
}: SidePanelProps) {
  const { t } = useI18n();
  const { giveUp, whiteName, blackName, matchScore, targetPoints } = useGame();
  const [showGiveUp, setShowGiveUp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel =
    opponentName ||
    (playerColor === "white"
      ? t("common.blackPlayer")
      : t("common.whitePlayer"));
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
        {targetPoints !== null && (
          <div className={styles.matchRules}>
            {t("game.matchTarget", { points: targetPoints })}
            {" · "}
            {state.doublingEnabled !== false
              ? t("game.doublingOn")
              : t("game.doublingOff")}
          </div>
        )}
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
        <div className="fixed right-[clamp(44px,7dvh,68px)] top-1/2 z-30 flex max-h-[calc(var(--app-height,100dvh)-16px)] w-[min(320px,calc(var(--app-width,100dvw)-64px))] -translate-y-1/2 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg border border-[var(--ui-accent-border)] [background:var(--ui-menu-bg,#101314)] p-3 shadow-2xl [&>div]:shrink-0 [&>label]:shrink-0" data-testid="match-control-drawer">
          <div className={styles.header}>
            <span className={styles.kicker}>{t("game.matchControl")}</span>
            <span
              className={
                activeColor === playerColor
                  ? styles.turnSelf
                  : styles.turnOpponent
              }
            >
              {activeColor === playerColor
                ? t("common.yourTurn")
                : t("common.opponentTurn")}
            </span>
          </div>

          <div className={`${styles.section} ${styles.languageSection}`}>
            <LanguageSwitcher />
            <InstallAppButton />
          </div>

          {boardTheme && onBoardThemeChange && (
            <div className={`${styles.section} ${styles.themeSection}`}>
              <BoardThemeSelector
                value={boardTheme}
                onChange={onBoardThemeChange}
              />
            </div>
          )}
          {onSoundEnabledChange && (
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded border border-white/15 px-3 text-sm text-white focus-within:ring-2 focus-within:ring-amber-300">
              <span>{t("game.soundEffects")}</span>
              <input
                type="checkbox"
                checked={soundEnabled ?? true}
                onChange={(event) => onSoundEnabledChange(event.target.checked)}
                className="size-5 accent-amber-400"
              />
            </label>
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
                <span className={styles.resignText}>
                  {t("game.giveUpCurrentConfirm")}
                </span>
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
                {state.gameFormat === "money"
                  ? t("game.leaveMoney")
                  : t("game.leaveSeries")}
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
