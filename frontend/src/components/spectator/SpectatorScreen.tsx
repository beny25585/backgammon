import { useParams } from "react-router-dom";
import { LanguageSwitcher } from "../LanguageSwitcher/LanguageSwitcher";
import SpectatorBoard from "./SpectatorBoard";
import { useSpectatorConnection } from "../../hooks/useSpectatorConnection";
import { useI18n } from "../../i18n/I18nProvider";

const actionClass = "inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-[#dfbc7c]/40 px-2 py-1.5 text-center text-sm leading-snug whitespace-normal text-[#f0ce85] hover:bg-[#dfbc7c]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dfbc7c]";

export default function SpectatorScreen({ returnUrl, serverUrl }: { returnUrl: string; serverUrl?: string }) {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const { t, direction } = useI18n();
  const { snapshot, status, error, retry } = useSpectatorConnection(roomId, serverUrl);
  const canRetry = status === "error" && (error === "full" || error === "unavailable");
  const statusKey = error ? `spectator.errors.${error}` : `spectator.status.${status}`;
  return (
    <main dir={direction} className="grid h-[var(--app-height,100dvh)] w-[var(--app-width,100dvw)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#090b0b] text-[#efe4ca] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-testid="spectator-screen">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-white/10 px-3 py-1">
        <h1 className="text-sm font-semibold text-[#dfbc7c]">{t("spectator.title")}</h1>
        {snapshot && <p className="min-w-0 text-xs text-[#b7aa92]" role="status" aria-live="polite" data-testid="spectator-status">{t(statusKey)}</p>}
      </header>
      <div dir="ltr" className="grid min-h-0 min-w-0 grid-cols-[clamp(7rem,12%,9rem)_minmax(0,1fr)]">
        <aside dir={direction} className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto border-r border-[#c8a66a]/30 bg-[#0c1011] px-2 py-2" data-testid="spectator-actions">
          {canRetry && <button type="button" onClick={retry} className={actionClass}>{t("spectator.retry")}</button>}
          <LanguageSwitcher className={actionClass} />
          <a href={returnUrl} className={actionClass}>{t("spectator.backToBracket")}</a>
        </aside>
        {snapshot ? <div dir={direction} className="min-h-0 min-w-0 px-1 py-1" aria-busy={status === "connecting" || status === "reconnecting"}>
          <SpectatorBoard snapshot={snapshot} />
        </div> : <div dir={direction} className="grid min-h-0 min-w-0 place-items-center px-6 text-center text-sm text-[#b7aa92]">
          <p role="status" aria-live="polite" data-testid="spectator-status">{t(statusKey)}</p>
        </div>}
      </div>
    </main>
  );
}
