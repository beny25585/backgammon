import { memo, useRef, useState } from "react";
import type { GameState } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import { useI18n } from "../../i18n/I18nProvider";
import BoardThemeSelector from "../BoardThemeSelector/BoardThemeSelector";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";
import { LanguageSwitcher } from "../LanguageSwitcher/LanguageSwitcher";
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

const buttonClass = "flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-amber-200/25 bg-[#211e17] px-1 py-1 text-xs font-semibold text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300";
const actionButtonClass = "flex min-h-11 w-full items-center justify-center rounded-lg border px-1 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-amber-300";
type GameAction = "giveUp" | "leave";

function GameSettingsPanel({ state, onLeave, boardTheme, onBoardThemeChange, soundEnabled,
  onSoundEnabledChange, bracketUrl, autoRoll, onAutoRollChange }: GameSettingsPanelProps) {
  const { t, direction } = useI18n();
  const { giveUp } = useGame();
  const [confirmingAction, setConfirmingAction] = useState<GameAction | null>(null);
  const confirmationRef = useRef<GameAction | null>(null);
  const actions = [
    {
      id: "giveUp",
      labelKey: "game.giveUp",
      confirmKey: "game.giveUpCurrentConfirm",
      toneClass: "border-orange-300/30 bg-orange-400/10 text-orange-200 hover:bg-orange-400/20",
      visible: true,
    },
    {
      id: "leave",
      labelKey: state.gameFormat === "money" ? "game.leaveMoney" : "game.leaveSeries",
      confirmKey: state.gameFormat === "money" ? "game.leaveMoneyConfirm" : "game.leaveSeriesConfirm",
      toneClass: "border-red-300/30 bg-red-400/10 text-red-200 hover:bg-red-400/20",
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
    <aside className="col-start-4 row-start-1 flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain bg-[#111617] p-2 text-white [scrollbar-color:#dfbc7c_#111617] [scrollbar-width:thin] [&>div]:shrink-0 @max-[620px]/game-layout:col-span-3 @max-[620px]/game-layout:col-start-1 @max-[620px]/game-layout:row-start-2 @max-[620px]/game-layout:flex-row @max-[620px]/game-layout:items-start @max-[620px]/game-layout:overflow-x-auto @max-[620px]/game-layout:p-0.5 @max-[620px]/game-layout:[&>div]:min-w-28"
      aria-label={t("game.matchControl")} data-testid="game-settings-panel">
      <div className="grid gap-1 @max-[620px]/game-layout:grid-cols-2" dir={direction}>
        <LanguageSwitcher className={buttonClass} />
        <InstallAppButton className={buttonClass} />
      </div>
      {boardTheme && onBoardThemeChange && (
        <div dir={direction}>
          <BoardThemeSelector value={boardTheme} onChange={onBoardThemeChange} compact />
        </div>
      )}
      {onSoundEnabledChange && (
        <div dir={direction}>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-1 rounded-lg bg-white/5 px-1 text-xs text-white/80 focus-within:ring-2 focus-within:ring-amber-300">
            <span>{t("game.soundEffects")}</span>
            <input type="checkbox" checked={soundEnabled ?? true} onChange={(event) => onSoundEnabledChange(event.target.checked)} className="size-5 shrink-0 accent-amber-400" />
          </label>
        </div>
      )}
      {(onAutoRollChange || bracketUrl) && (
        <div className="flex flex-wrap justify-center gap-1">
          {onAutoRollChange && <AutoRoll autoRoll={autoRoll ?? false} onChange={onAutoRollChange} />}
          {bracketUrl && <a href={bracketUrl} target="_blank" rel="noopener noreferrer" className="grid size-11 shrink-0 place-items-center rounded-lg border border-amber-200/25 bg-[#211e17] text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300" title={t("game.viewBracket")} aria-label={t("game.viewBracket")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 3v18M4 4h15l-4 5 4 5H4" /></svg></a>}
        </div>
      )}
      <div className="mt-auto grid gap-1 @max-[620px]/game-layout:mt-0 @max-[620px]/game-layout:grid-cols-2" dir={direction}>
        {actions.filter(action => action.visible).map(action => confirmingAction === action.id ? (
          <div key={action.id} className="grid gap-1 text-center text-xs text-white/80 @max-[620px]/game-layout:col-span-2" role="group" aria-label={t(action.confirmKey)}>
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
