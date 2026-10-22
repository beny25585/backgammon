import { memo, useState } from "react";
import { createPortal } from "react-dom";
import FullscreenButton from "./FullscreenButton";
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
import { useRoomPlayerDetails } from "../../hooks/useRoomPlayerDetails";
import GameInfoCard from "./GameInfoCard";
import { AutoRoll } from "../autoRoll/AutoRoll";

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
  controlsTarget?: HTMLElement | null;
  bracketUrl?: string;
  autoRoll?: boolean;
  onAutoRollChange?: (enabled: boolean) => void;
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
  controlsTarget,
  bracketUrl,
  autoRoll,
  onAutoRollChange,
}: SidePanelProps) {
  const { t } = useI18n();
  const { giveUp, whiteName, blackName, matchScore, targetPoints, roomId } = useGame();
  const details = useRoomPlayerDetails(roomId);
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
  const selfLabel = selfName || (playerColor === "white"
      ? `${t("common.you")} (${t("common.white")})`
      : `${t("common.you")} (${t("common.black")})`);
  const stripMyLabel = selfName || t("common.you");
  const stripOppLabel = opponentName || t("common.opponent");
  const activeColor = activePlayerOf(state);
  const delayMs = timeControl?.delay ?? 0;
  const controls = <>
    {onAutoRollChange && <AutoRoll autoRoll={autoRoll ?? false} onChange={onAutoRollChange} />}
    <FullscreenButton />
    {bracketUrl && <a href={bracketUrl} target="_blank" rel="noopener noreferrer" className="grid size-11 shrink-0 place-items-center rounded-lg border border-amber-200/25 bg-[#211e17] text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300" title={t("game.viewBracket")} aria-label={t("game.viewBracket")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 3v18M4 4h15l-4 5 4 5H4" /></svg></a>}
    <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg border border-amber-200/25 bg-[#211e17] text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300" aria-label={t("game.matchControl")} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" /></svg></button>
  </>;

  return (
    <div className="col-start-1 row-start-1 grid min-h-0 min-w-0 grid-rows-[auto_auto_auto] content-between items-center gap-1 overflow-y-auto bg-[#090d0e] px-2 py-2 [container-type:inline-size] [scrollbar-width:thin]" data-testid="side-panel">
      <div className="w-full min-w-0 self-start">
        <PlayerRow
          color={opponentColor}
          state={state}
          label={opponentLabel}
          active={activeColor === opponentColor}
          self={false}
          score={matchScore?.[opponentColor] ?? 0}
          details={details.players?.[opponentColor]}
        />
      </div>

      <div className="w-full min-w-0">
        <GameInfoCard state={state} targetPoints={targetPoints} />
        {details.loading && <span role="status" className="sr-only">{t("game.loadingPlayerDetails")}</span>}
        {details.unavailable && (
          <button type="button" onClick={details.retry} className="mb-1 min-h-11 w-full rounded px-1 text-[clamp(10px,5cqw,13px)] text-amber-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300">
            {t("game.retryPlayerDetails")}
          </button>
        )}
        <div className="[&>div:first-child]:flex-col">
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
      </div>

      {controlsTarget ? createPortal(controls, controlsTarget) : controlsTarget === undefined ? <div className="absolute right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2">{controls}</div> : null}

      <div className="w-full min-w-0 self-end">
        <PlayerRow
          color={playerColor}
          state={state}
          label={selfLabel}
          active={activeColor === playerColor}
          self={true}
          score={matchScore?.[playerColor] ?? 0}
          details={details.players?.[playerColor]}
        />
      </div>

      {menuOpen && (
        <div className="absolute right-20 top-1/2 z-60 flex max-h-[calc(100%-16px)] w-[min(280px,calc(100%-104px))] -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#111617] p-4 text-sm text-white shadow-2xl [&>div]:shrink-0 [&>label]:shrink-0" data-testid="match-control-drawer">
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
          className="absolute inset-0 z-50 border-0 bg-black/30"
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
