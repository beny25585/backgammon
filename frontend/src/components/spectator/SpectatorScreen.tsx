import { useParams } from "react-router-dom";
import { LanguageSwitcher } from "../LanguageSwitcher/LanguageSwitcher";
import SpectatorBoard from "./SpectatorBoard";
import { useSpectatorConnection } from "../../hooks/useSpectatorConnection";
import { useI18n } from "../../i18n/I18nProvider";

const actionClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#dfbc7c]/40 px-3 py-1.5 text-sm text-[#f0ce85] hover:bg-[#dfbc7c]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dfbc7c]";

export default function SpectatorScreen({ returnUrl, serverUrl }: { returnUrl: string; serverUrl?: string }) {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const { t, direction } = useI18n();
  const { snapshot, status, error, retry } = useSpectatorConnection(roomId, serverUrl);
  const canRetry = status === "error" && (error === "full" || error === "unavailable");
  const statusKey = error ? `spectator.errors.${error}` : `spectator.status.${status}`;
  return (
    <main dir={direction} className="grid h-[var(--app-height,100dvh)] w-[var(--app-width,100dvw)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#090b0b] text-[#efe4ca] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-testid="spectator-screen">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-white/10 px-3 py-1.5">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-[#dfbc7c]">{t("spectator.title")}</h1>
          {snapshot && <p className="text-xs text-[#b7aa92]" role="status" aria-live="polite" data-testid="spectator-status">{t(statusKey)}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canRetry && <button type="button" onClick={retry} className={actionClass}>{t("spectator.retry")}</button>}
          <LanguageSwitcher />
          <a href={returnUrl} className={actionClass}>{t("spectator.backToBracket")}</a>
        </div>
      </header>
      {snapshot ? <div className="min-h-0 min-w-0 px-1 py-1" aria-busy={status === "connecting" || status === "reconnecting"}>
        <SpectatorBoard snapshot={snapshot} />
      </div> : <div className="grid min-h-0 place-items-center px-6 text-center text-sm text-[#b7aa92]">
        <p role="status" aria-live="polite" data-testid="spectator-status">{t(statusKey)}</p>
      </div>}
    </main>
  );
}
