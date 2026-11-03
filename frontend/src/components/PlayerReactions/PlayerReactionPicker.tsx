import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { PLAYER_REACTIONS, type PlayerReactionId } from "../../lib/playerReactions";

interface PlayerReactionPickerProps {
  enabled: boolean;
  cooldownUntil: number;
  error: "cooldown" | "unavailable" | "invalid" | null;
  muted: boolean;
  onToggleMuted: () => void;
  onSend: (id: PlayerReactionId) => boolean;
}

/** Native dialog supplies keyboard focus, Escape and focus restoration. */
export default function PlayerReactionPicker({ enabled, cooldownUntil, error, muted, onToggleMuted, onSend }: PlayerReactionPickerProps) {
  const { t, direction } = useI18n();
  const panelId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const coolingDown = cooldownUntil > now;
  const sendFailed = error === "unavailable" || error === "invalid";

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), cooldownUntil - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    if (!enabled && dialogRef.current?.open) dialogRef.current.close();
  }, [enabled]);

  function close() {
    dialogRef.current?.close();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function dismissBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t(sendFailed ? "reactions.retryLabel" : "reactions.open")}
        title={sendFailed ? t(`reactions.errors.${error}`) : t("reactions.open")}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}
        className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-amber-200/25 bg-[#171b19] px-1 text-[11px] font-semibold text-[#ebc879] hover:border-amber-200/60 hover:bg-[#252a24] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" /><path d="M7 11h.01M12 11h.01M17 11h.01" /></svg>
        <span>{t(sendFailed ? "reactions.retry" : "reactions.button")}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">{sendFailed ? t(`reactions.errors.${error}`) : ""}</span>
      <dialog
        ref={dialogRef}
        id={panelId}
        aria-labelledby={titleId}
        dir={direction}
        onClose={() => setOpen(false)}
        onClick={dismissBackdrop}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-24px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-2xl border border-[#c8a66a]/50 bg-[#101514] p-3 text-[#f7f1e7] shadow-2xl backdrop:bg-black/40"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-bold text-[#ebc879]">{t("reactions.title")}</h2>
          <button type="button" autoFocus onClick={close} aria-label={t("reactions.close")} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-xl text-[#ebc879] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300">×</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PLAYER_REACTIONS.filter((item) => !item.emoji).map((item) => (
            <button key={item.id} type="button" disabled={!enabled || coolingDown} onClick={() => { if (onSend(item.id)) close(); }} className="min-h-11 rounded-lg border border-amber-200/20 bg-[#20251f] px-2 py-2 text-sm font-semibold text-[#f0d18a] hover:border-amber-200/60 hover:bg-[#30362a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
              {t(`reactions.items.${item.id}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 min-[360px]:grid-cols-6">
          {PLAYER_REACTIONS.filter((item) => item.emoji).map((item) => (
            <button key={item.id} type="button" aria-label={t(`reactions.items.${item.id}`)} title={t(`reactions.items.${item.id}`)} disabled={!enabled || coolingDown} onClick={() => { if (onSend(item.id)) close(); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-amber-200/20 bg-[#20251f] text-2xl hover:border-amber-200/60 hover:bg-[#30362a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
              <span aria-hidden="true">{item.emoji}</span>
            </button>
          ))}
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-[#edce91]">
          {coolingDown ? t("reactions.cooldown") : error ? t(`reactions.errors.${error}`) : ""}
        </p>
        <button type="button" aria-pressed={muted} onClick={onToggleMuted} className="mt-1 min-h-11 w-full rounded-lg border border-amber-200/20 px-2 py-2 text-xs text-[#edce91] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
          {t(muted ? "reactions.unmute" : "reactions.mute")}
        </button>
      </dialog>
    </>
  );
}
