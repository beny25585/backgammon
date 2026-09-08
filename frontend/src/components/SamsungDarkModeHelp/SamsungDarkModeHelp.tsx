import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider";
import InstallAppButton from "../InstallAppButton/InstallAppButton";
import styles from "./SamsungDarkModeHelp.module.css";

const SAMSUNG_BROWSER_PATTERN = /SamsungBrowser/i;

export function isSamsungInternet(userAgent = navigator.userAgent) {
  return SAMSUNG_BROWSER_PATTERN.test(userAgent);
}

function chromeIntentUrl() {
  const { protocol, host, pathname, search } = window.location;
  const scheme = protocol.replace(":", "") || "https";
  const fallback = encodeURIComponent(
    "https://play.google.com/store/apps/details?id=com.android.chrome",
  );

  return `intent://${host}${pathname}${search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

interface SamsungDarkModeHelpProps {
  userAgent?: string;
}

export default function SamsungDarkModeHelp({
  userAgent = navigator.userAgent,
}: SamsungDarkModeHelpProps) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const samsungInternet = useMemo(() => isSamsungInternet(userAgent), [userAgent]);

  useEffect(() => {
    if (!samsungInternet) return;
    document.documentElement.dataset.samsungInternet = "true";
    return () => {
      delete document.documentElement.dataset.samsungInternet;
    };
  }, [samsungInternet]);

  useEffect(() => {
    if (!showHelp) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelp]);

  if (!samsungInternet) return null;

  return (
    <>
      <button
        type="button"
        className={styles.helpTrigger}
        onClick={() => setShowHelp(true)}
      >
        <span aria-hidden="true">☀</span>
        {t("common.samsungDarkTrigger")}
      </button>

      {showHelp &&
        createPortal(
          <div
            className={styles.dialogBackdrop}
            onMouseDown={() => setShowHelp(false)}
          >
            <section
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="samsung-dark-help-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.closeButton}
                aria-label={t("common.closeSamsungDarkHelp")}
                onClick={() => setShowHelp(false)}
              >
                ×
              </button>

              <span className={styles.dialogIcon} aria-hidden="true">☀</span>
              <h2 id="samsung-dark-help-title">
                {t("common.samsungDarkTitle")}
              </h2>
              <p>{t("common.samsungDarkIntro")}</p>

              <div className={styles.steps}>
                {t("common.samsungDarkSteps")}
              </div>

              <div className={styles.actions}>
                <a
                  className={styles.chromeButton}
                  href={chromeIntentUrl()}
                  data-testid="open-in-chrome"
                >
                  {t("common.openInChrome")}
                </a>
                <InstallAppButton />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
