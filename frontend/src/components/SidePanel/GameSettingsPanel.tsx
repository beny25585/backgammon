import { memo, useRef, useState } from "react";
import type { GameState } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import { useI18n } from "../../i18n/I18nProvider";
import BoardThemeSelector from "../BoardThemeSelector/BoardThemeSelector";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";
import InstallAppButton from "../InstallAppButton/InstallAppButton";
import { AutoRoll } from "../autoRoll/AutoRoll";
import { CHECKER_STYLES, isCheckerStyle, type CheckerStyle } from "../Board/materials/checkerStyles";
import GamePlayerAccounts from "./GamePlayerAccounts";
import GameInfoCard from "./GameInfoCard";

interface GameSettingsPanelProps {
  state: GameState;
  onLeave?: (outcome?: "won" | "lost") => void;
  boardTheme?: BoardTheme;
  onBoardThemeChange?: (theme: BoardTheme) => void;
  checkerStyle?: CheckerStyle;
  onCheckerStyleChange?: (style: CheckerStyle) => void;
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
  bracketUrl?: string;
  autoRoll?: boolean;
  onAutoRollChange?: (enabled: boolean) => void;
}

const buttonClass = "flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-white/15 bg-white/[0.025] px-3 py-2 text-[clamp(12px,1cqw,16px)] font-semibold leading-snug text-white/75 hover:border-amber-200/30 hover:bg-white/5 hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:px-2 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:py-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-xs";
const actionButtonClass = "flex min-h-12 w-full items-center justify-center rounded-[10px] border px-3 py-2 text-[clamp(13px,1.05cqw,17px)] font-semibold leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:px-2 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:py-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-xs";
type GameAction = "giveUp" | "leave";

function GameSettingsPanel({ state, onLeave, boardTheme, onBoardThemeChange, checkerStyle, onCheckerStyleChange, soundEnabled,
  onSoundEnabledChange, bracketUrl, autoRoll, onAutoRollChange }: GameSettingsPanelProps) {
  const { t, direction, locale, toggleLocale } = useI18n();
  const { giveUp, targetPoints, matchScore, adminReviewPending } = useGame();
  const [confirmingAction, setConfirmingAction] = useState<GameAction | null>(null);
  const confirmationRef = useRef<GameAction | null>(null);
  const actions = [
    {
      id: "giveUp",
      labelKey: "game.giveUp",
      confirmKey: "game.giveUpCurrentConfirm",
      toneClass: "border-orange-400/40 bg-orange-950/10 text-orange-300 hover:border-orange-300/70 hover:bg-orange-400/10",
      visible: !adminReviewPending,
    },
    {
      id: "leave",
      labelKey: state.gameFormat === "money" ? "game.leaveMoney" : "game.leaveSeries",
      confirmKey: state.gameFormat === "money" ? "game.leaveMoneyConfirm" : "game.leaveSeriesConfirm",
      toneClass: "border-red-400/40 bg-red-950/10 text-red-300 hover:border-red-300/70 hover:bg-red-400/10",
      visible: Boolean(onLeave),
    },
  ] as const;

  function requestConfirmation(action: GameAction) {
    confirmationRef.current = action;
    setConfirmingAction(action);
  }

  function cancelConfirmation() {
    confirmationRef.current = null;
    setConfirmingAction(null);
  }

  function confirmAction() {
    const action = confirmationRef.current;
    cancelConfirmation();
    if (action === "giveUp") giveUp();
    if (action === "leave") onLeave?.();
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col gap-[clamp(8px,2cqh,20px)] overflow-y-auto overscroll-contain bg-[#1b1511] px-3 pb-5 text-[#f7f1e7] [scrollbar-color:#a98a51_#1b1511] [scrollbar-width:thin] [&>div]:shrink-0 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1.5 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:px-2 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:pb-3"
      aria-label={t("game.matchControl")} data-testid="game-settings-panel" dir={direction}>
      <h2 className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center bg-[#1b1511] py-3 pe-12 text-start text-[clamp(16px,1.6cqw,23px)] leading-tight font-bold text-[#ebc879] [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:min-h-12 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:py-2 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-sm">{t("game.settingsTitle")}</h2>
      <GamePlayerAccounts />
      <GameInfoCard state={state} targetPoints={targetPoints} mode="details"
        leadingScore={Math.max(matchScore?.white ?? 0, matchScore?.black ?? 0)} />
      <div>
        <label className="relative block">
          <span className="sr-only">{t("common.language")}</span>
          <select value={locale} onChange={(event) => { if (event.target.value !== locale) toggleLocale(); }} className="min-h-[clamp(44px,5.4cqh,53px)] w-full appearance-none rounded-[10px] border border-white/15 bg-[#101515] py-2 pr-9 pl-3 text-left text-[clamp(13px,1.05cqw,16px)] font-normal text-white/90 hover:border-amber-200/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:py-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:pl-2 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-xs">
            <option value="he">{t("common.hebrew")}</option>
            <option value="en">{t("common.english")}</option>
          </select>
          <svg className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </label>
      </div>
      {boardTheme && onBoardThemeChange && (
        <div>
          <BoardThemeSelector value={boardTheme} onChange={onBoardThemeChange} compact />
        </div>
      )}
      {checkerStyle && onCheckerStyleChange && (
        <div>
          <label className="grid gap-1.5 text-start text-[clamp(13px,1.05cqw,16px)] font-normal leading-tight text-white/90 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-xs">
            <span>{t("game.checkerStyle")}</span>
            <span className="relative block">
              <select
                value={checkerStyle}
                dir={direction}
                data-testid="checker-style-select"
                onChange={(event) => {
                  const value = event.target.value;
                  if (isCheckerStyle(value)) onCheckerStyleChange(value);
                }}
                className="min-h-[clamp(44px,5.4cqh,53px)] w-full appearance-none rounded-[10px] border border-[#e3bd7b]/25 bg-[#241b14] py-2 ps-3 pe-9 text-start font-normal text-white/90 hover:border-amber-200/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:py-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:ps-2"
              >
                {CHECKER_STYLES.map((style) => (
                  <option key={style} value={style}>{t(`game.checkerStyles.${style}`)}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute top-1/2 end-3 size-5 -translate-y-1/2 text-[#ebc879]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </label>
        </div>
      )}
      {(onSoundEnabledChange || onAutoRollChange) && (
        <div className="mt-1 grid gap-[clamp(4px,2cqh,20px)] [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1">
          {onSoundEnabledChange && (
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-1 text-left text-[clamp(13px,1.1cqw,18px)] leading-snug text-white/90 hover:bg-white/[0.035] [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-xs" dir="ltr">
              <span dir={direction}>{t("game.soundEffects")}</span>
              <input type="checkbox" checked={soundEnabled ?? true} onChange={(event) => onSoundEnabledChange(event.target.checked)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full border border-white/15 bg-[#322820] after:absolute after:left-1 after:top-1 after:size-3.5 after:rounded-full after:bg-white/60 motion-safe:after:transition-[translate] motion-safe:after:duration-[140ms] motion-safe:after:ease-out peer-checked:border-[#e7c273] peer-checked:bg-[#b18a3f] peer-checked:after:translate-x-3.5 peer-checked:after:bg-[#fff9e7] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-amber-300" />
            </label>
          )}
          {onAutoRollChange && <AutoRoll autoRoll={autoRoll ?? false} onChange={onAutoRollChange} presentation="switch" />}
        </div>
      )}
      <div className="mt-[clamp(0px,0.8cqh,8px)] grid gap-2 border-t border-white/15 pt-[clamp(8px,2cqh,20px)] empty:hidden [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:mt-0 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1.5 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:pt-2">
        <InstallAppButton className={buttonClass} />
        {bracketUrl && <a href={bracketUrl} target="_blank" rel="noopener noreferrer" className={buttonClass} title={t("game.viewBracket")}><svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M4 3v18M4 4h15l-4 5 4 5H4" /></svg><span>{t("game.viewBracket")}</span></a>}
      </div>
      <div className="mt-auto grid gap-3.5 pt-4 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1.5 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:pt-2">
        {actions.filter(action => action.visible).map(action => confirmingAction === action.id ? (
          <div key={action.id} className="grid gap-2 rounded-lg bg-white/[0.035] p-2 text-center text-xs leading-relaxed text-white/80 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:gap-1.5 [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:text-[11px] [@media(hover:none)_and_(pointer:coarse)]:[@container_game-frame_(height<500px)]:leading-snug" role="group" aria-label={t(action.confirmKey)}>
            <span>{t(action.confirmKey)}</span>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className={`${actionButtonClass} ${action.toneClass}`} onClick={confirmAction}>{t("common.yes")}</button>
              <button type="button" className={buttonClass} onClick={cancelConfirmation}>{t("common.no")}</button>
            </div>
          </div>
        ) : (
          <button key={action.id} type="button" className={`${actionButtonClass} ${action.toneClass}`} onClick={() => requestConfirmation(action.id)}>{t(action.labelKey)}</button>
        ))}
      </div>
    </aside>
  );
}

export default memo(GameSettingsPanel);
