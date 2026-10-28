import { memo, useRef, useState } from "react";
import type { GameState } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import { useI18n } from "../../i18n/I18nProvider";
import BoardThemeSelector from "../BoardThemeSelector/BoardThemeSelector";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";
import InstallAppButton from "../InstallAppButton/InstallAppButton";
import { AutoRoll } from "../autoRoll/AutoRoll";

interface GameSettingsPanelProps {
  state: GameState;
  onLeave?: (outcome?: "won" | "lost") => void;
  boardTheme?: BoardTheme;
  onBoardThemeChange?: (theme: BoardTheme) => void;
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
  bracketUrl?: string;
  autoRoll?: boolean;
  onAutoRollChange?: (enabled: boolean) => void;
}

const buttonClass = "flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-white/15 bg-white/[0.025] px-3 py-2 text-[clamp(12px,1cqw,16px)] font-semibold leading-snug text-white/75 hover:border-amber-200/30 hover:bg-white/5 hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300";
const actionButtonClass = "flex min-h-12 w-full items-center justify-center rounded-[10px] border px-3 py-2 text-[clamp(13px,1.05cqw,17px)] font-semibold leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 @max-[620px]/game-layout:min-h-11 @max-[620px]/game-layout:text-xs";
type GameAction = "giveUp" | "leave";

function GameSettingsPanel({ state, onLeave, boardTheme, onBoardThemeChange, soundEnabled,
  onSoundEnabledChange, bracketUrl, autoRoll, onAutoRollChange }: GameSettingsPanelProps) {
  const { t, direction, locale, toggleLocale } = useI18n();
  const { giveUp } = useGame();
  const [confirmingAction, setConfirmingAction] = useState<GameAction | null>(null);
  const confirmationRef = useRef<GameAction | null>(null);
  const actions = [
    {
      id: "giveUp",
      labelKey: "game.giveUp",
      confirmKey: "game.giveUpCurrentConfirm",
      toneClass: "border-orange-400/40 bg-orange-950/10 text-orange-300 hover:border-orange-300/70 hover:bg-orange-400/10",
      visible: true,
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
    <aside className="col-start-3 row-span-2 row-start-2 flex min-h-0 min-w-0 flex-col gap-[clamp(8px,2cqh,20px)] overflow-y-auto overscroll-contain border-l border-amber-200/15 bg-[#0b0f0f] px-3 pt-[clamp(12px,3.65cqh,36px)] pb-[clamp(20px,7.5cqh,74px)] text-white [scrollbar-color:#a98a51_#0b0f0f] [scrollbar-width:thin] [&>div]:shrink-0 @max-[620px]/game-layout:col-span-2 @max-[620px]/game-layout:col-start-1 @max-[620px]/game-layout:row-span-1 @max-[620px]/game-layout:row-start-3 @max-[620px]/game-layout:flex-row @max-[620px]/game-layout:items-start @max-[620px]/game-layout:gap-2 @max-[620px]/game-layout:overflow-x-auto @max-[620px]/game-layout:border-l-0 @max-[620px]/game-layout:border-t @max-[620px]/game-layout:p-0.5 @min-[1000px]/game-layout:px-6"
      aria-label={t("game.matchControl")} data-testid="game-settings-panel" dir={direction}>
      <h2 className="text-left text-[clamp(16px,1.6cqw,23px)] leading-tight font-bold text-[#ebc879] @max-[620px]/game-layout:hidden">{t("game.settingsTitle")}</h2>
      <div className="@max-[620px]/game-layout:w-32">
        <label className="relative block">
          <span className="sr-only">{t("common.language")}</span>
          <select value={locale} onChange={(event) => { if (event.target.value !== locale) toggleLocale(); }} className="min-h-[clamp(44px,5.4cqh,53px)] w-full appearance-none rounded-[10px] border border-white/15 bg-[#101515] py-2 pr-9 pl-3 text-left text-[clamp(13px,1.05cqw,16px)] font-normal text-white/90 hover:border-amber-200/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 @max-[620px]/game-layout:min-h-11">
            <option value="he">{t("common.hebrew")}</option>
            <option value="en">{t("common.english")}</option>
          </select>
          <svg className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </label>
      </div>
      {boardTheme && onBoardThemeChange && (
        <div className="@max-[620px]/game-layout:w-44">
          <BoardThemeSelector value={boardTheme} onChange={onBoardThemeChange} compact />
        </div>
      )}
      {(onSoundEnabledChange || onAutoRollChange) && (
        <div className="mt-1 grid gap-[clamp(4px,2cqh,20px)] @max-[620px]/game-layout:mt-0 @max-[620px]/game-layout:flex @max-[620px]/game-layout:gap-2">
          {onSoundEnabledChange && (
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-1 text-left text-[clamp(13px,1.1cqw,18px)] leading-snug text-white/90 hover:bg-white/[0.035] @max-[620px]/game-layout:w-36 @max-[620px]/game-layout:px-2 @max-[620px]/game-layout:text-xs" dir="ltr">
              <span dir={direction}>{t("game.soundEffects")}</span>
              <input type="checkbox" checked={soundEnabled ?? true} onChange={(event) => onSoundEnabledChange(event.target.checked)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full border border-white/15 bg-[#292d2d] after:absolute after:start-1 after:top-1 after:size-3.5 after:rounded-full after:bg-white/60 peer-checked:border-[#e7c273] peer-checked:bg-[#b18a3f] peer-checked:after:start-[1.125rem] peer-checked:after:bg-[#fff9e7] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-amber-300" />
            </label>
          )}
          {onAutoRollChange && <AutoRoll autoRoll={autoRoll ?? false} onChange={onAutoRollChange} presentation="switch" />}
        </div>
      )}
      <div className="mt-[clamp(0px,0.8cqh,8px)] grid gap-2 border-t border-white/15 pt-[clamp(8px,2cqh,20px)] empty:hidden @max-[620px]/game-layout:mt-0 @max-[620px]/game-layout:flex @max-[620px]/game-layout:border-t-0 @max-[620px]/game-layout:pt-0 @max-[620px]/game-layout:[&>*]:w-36">
        <InstallAppButton className={buttonClass} />
        {bracketUrl && <a href={bracketUrl} target="_blank" rel="noopener noreferrer" className={buttonClass} title={t("game.viewBracket")}><svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M4 3v18M4 4h15l-4 5 4 5H4" /></svg><span>{t("game.viewBracket")}</span></a>}
      </div>
      <div className="mt-auto grid gap-3.5 pt-4 @max-[620px]/game-layout:mt-0 @max-[620px]/game-layout:min-w-72 @max-[620px]/game-layout:grid-cols-2 @max-[620px]/game-layout:gap-2 @max-[620px]/game-layout:pt-0">
        {actions.filter(action => action.visible).map(action => confirmingAction === action.id ? (
          <div key={action.id} className="grid gap-2 rounded-lg bg-white/[0.035] p-2 text-center text-xs leading-relaxed text-white/80 @max-[620px]/game-layout:col-span-2" role="group" aria-label={t(action.confirmKey)}>
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
