import { useI18n } from "../../i18n/I18nProvider";

export function AutoRoll({
  autoRoll,
  onChange,
}: {
  autoRoll: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const label = t(autoRoll ? "game.autoRollOn" : "game.autoRollOff");

  return (
    <button
      type="button"
      data-testid="auto-roll-toggle"
      aria-label={label}
      title={label}
      aria-pressed={autoRoll}
      onClick={() => onChange(!autoRoll)}
      className="flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-200/25 bg-[#211e17] text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300 aria-pressed:border-amber-200 aria-pressed:bg-amber-200 aria-pressed:text-[#211e17] aria-pressed:hover:bg-amber-100"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <circle cx="8" cy="8" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="16" cy="16" r="1" fill="currentColor" />
      </svg>
      <span className="text-[10px] leading-none font-bold">{t(autoRoll ? "game.autoRollEnabled" : "game.autoRollDisabled")}</span>
    </button>
  );
}
