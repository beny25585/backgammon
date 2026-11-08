import { Link as RouterLink } from "react-router-dom";
import BrandLockup from "../BrandLockup";
import { LanguageSwitcher } from "../LanguageSwitcher/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";

const CLUB_TARGETS = {
  local: {
    url: "http://backgammon.localhost:8180/6b/tournaments/",
    subtitle: "mobileStart.development",
    label: "mobileStart.club",
    hint: "mobileStart.clubHint",
  },
  preview: {
    url: "https://38.247.146.17.nip.io/6b/tournaments/",
    subtitle: "mobileStart.preview",
    label: "mobileStart.previewClub",
    hint: "mobileStart.previewClubHint",
  },
};

export default function MobileStart({ target }: { target: keyof typeof CLUB_TARGETS }) {
  const { t } = useI18n();
  const club = CLUB_TARGETS[target];

  return (
    <main className="h-[var(--app-height,100dvh)] overflow-y-auto bg-[#03090a] pt-[max(1.5rem,env(safe-area-inset-top,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pl-[max(1.25rem,env(safe-area-inset-left,0px))]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup size="lg" subtitle={t(club.subtitle)} />
          <LanguageSwitcher className="min-h-11 rounded-lg border border-[var(--color-border)] bg-transparent px-3 text-sm font-bold text-[var(--color-parchment)] hover:border-[var(--color-brand-gold)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-gold-light)]" />
        </header>
        <section aria-labelledby="mobile-start-title" className="grid gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--surface-panel)] p-4 text-start sm:p-5">
          <h1 id="mobile-start-title" className="text-xl font-bold text-[var(--color-parchment)]">
            {t("mobileStart.title")}
          </h1>
          <div className="grid gap-3">
            <a
              href={club.url}
              className="grid min-h-11 gap-0.5 rounded-lg bg-[var(--color-brand-gold-light)] px-4 py-3 text-base font-bold text-[var(--color-ink)] no-underline hover:bg-[var(--color-brand-gold-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-gold-light)]"
            >
              <span>{t(club.label)}</span>
              <span className="text-sm font-medium">{t(club.hint)}</span>
            </a>
            <RouterLink
              to="/local?bot=black"
              className="grid min-h-11 gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink)] px-4 py-3 text-base font-bold text-[var(--color-parchment)] no-underline hover:border-[var(--color-brand-gold)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-gold-light)]"
            >
              <span>{t("home.bot")}</span>
              <span className="text-sm font-medium text-[var(--color-text-soft)]">{t("mobileStart.botHint")}</span>
            </RouterLink>
          </div>
        </section>
      </div>
    </main>
  );
}
