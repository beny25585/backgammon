import { useI18n } from "../../i18n/I18nProvider";

export function AutoRoll({
  autoRoll,
  onChange,
  presentation = "icon",
}: {
  autoRoll: boolean;
  onChange: (value: boolean) => void;
  presentation?: "icon" | "switch";
}) {
  const { t, direction } = useI18n();
  const label = t(autoRoll ? "game.autoRollOn" : "game.autoRollOff");

  if (presentation === "switch") {
    return (
      <button
        type="button"
        data-testid="auto-roll-toggle"
        aria-label={label}
        title={label}
        aria-pressed={autoRoll}
        onClick={() => onChange(!autoRoll)}
        className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-transparent bg-transparent px-1 text-left text-[clamp(13px,1.1cqw,18px)] leading-snug text-white/90 hover:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 @max-[620px]/game-layout:w-44 @max-[620px]/game-layout:px-2 @max-[620px]/game-layout:text-xs"
        dir="ltr"
      >
        <span dir={direction}>{t("common.autoRoll")}</span>
        <span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full border border-white/15 bg-[#292d2d] after:absolute after:start-1 after:top-1 after:size-3.5 after:rounded-full after:bg-white/60 group-aria-pressed:border-[#e7c273] group-aria-pressed:bg-[#b18a3f] group-aria-pressed:after:start-[1.125rem] group-aria-pressed:after:bg-[#fff9e7]" />
      </button>
    );
  }

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
