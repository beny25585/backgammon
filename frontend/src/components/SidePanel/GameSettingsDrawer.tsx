import { useCallback, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useI18n } from "../../i18n/I18nProvider";

/** Nonmodal: the players and uncovered board remain usable while settings are open. */
export default function GameSettingsDrawer({ children, settings }: {
  children: (toggle: ReactNode) => ReactNode;
  settings: ReactNode;
}) {
  const { t, direction } = useI18n();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [{ open, animate }, setDrawer] = useState({ open: false, animate: false });
  const panelRef = useCallback((element: HTMLDivElement | null) => {
    if (element) element.inert = !open;
  }, [open]);
  const label = t(open ? "game.closeSettings" : "game.openSettings");

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    setDrawer({ open: !open, animate: event.detail > 0 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Installation help is rendered in a portal and owns its own Escape handling.
    if (event.key !== "Escape" || event.defaultPrevented ||
      !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    setDrawer({ open: false, animate: false });
    toggleRef.current?.focus();
  }

  return (
    <>
      {children(<button
        ref={toggleRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="game-settings-toggle"
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-200/25 bg-[#171b19] px-2 text-xs font-semibold text-[#ebc879] hover:border-amber-200/60 hover:bg-[#252a24] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        dir={direction}
        onClick={toggle}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            setDrawer({ open: false, animate: false });
          }
        }}
      >
        <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
        <span>{t("game.settingsMenu")}</span>
      </button>)}
      <div
        ref={panelRef}
        id={panelId}
        aria-hidden={!open}
        onKeyDown={handleKeyDown}
        className={`relative z-50 col-start-2 row-start-2 h-full min-h-0 w-[clamp(200px,22cqw,280px)] max-w-full overflow-hidden border-r border-amber-200/20 bg-[#0b0f0f] shadow-[12px_0_28px_#0008] ${animate ? "transition-[transform,opacity,visibility] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none" : ""} ${open ? "visible translate-x-0 opacity-100" : "pointer-events-none invisible -translate-x-4 opacity-0"}`}
      >
        {settings}
      </div>
    </>
  );
}
