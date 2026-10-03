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
        <div className="fixed right-[clamp(44px,7dvh,68px)] top-1/2 z-30 flex max-h-[calc(var(--app-height,100dvh)-16px)] w-[min(280px,calc(var(--app-width,100dvw)-64px))] -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#111617] p-4 text-sm text-white shadow-2xl [&>div]:shrink-0 [&>label]:shrink-0" data-testid="match-control-drawer">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <span className="text-sm font-bold text-white">{t("game.matchControl")}</span>
            <span
              className="text-xs font-medium text-white/50"
            >
              {activeColor === playerColor
                ? t("common.yourTurn")
                : t("common.opponentTurn")}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <LanguageSwitcher className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300" />
            <InstallAppButton className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300" />
          </div>

          {boardTheme && onBoardThemeChange && (
            <div>
              <BoardThemeSelector
                value={boardTheme}
                onChange={onBoardThemeChange}
              />
            </div>
          )}
          {onSoundEnabledChange && (
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg bg-white/5 px-3 text-sm text-white/80 focus-within:ring-2 focus-within:ring-amber-300">
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
