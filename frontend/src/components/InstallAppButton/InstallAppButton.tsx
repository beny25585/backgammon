import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./InstallAppButton.module.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  );
}

function instructionKey() {
  const agent = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(agent)) return "common.installIos";
  if (/Android/i.test(agent)) return "common.installAndroid";
  if (/Firefox/i.test(agent)) return "common.installFirefoxDesktop";
  return "common.installDesktop";
}

export default function InstallAppButton() {
  const { t } = useI18n();
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowHelp(false);
    };
    const handleDisplayMode = () => setInstalled(isStandalone());

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    displayMode.addEventListener?.("change", handleDisplayMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener?.("change", handleDisplayMode);
    };
  }, []);

  useEffect(() => {
    if (!showHelp) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelp]);

  if (installed) return null;

  async function handleInstall() {
    if (!installPrompt) {
      setShowHelp(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } catch {
      setShowHelp(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.installButton}
        onClick={handleInstall}
        aria-label={t("common.installApp")}
      >
        <span aria-hidden="true">⇩</span>
        {t("common.installApp")}
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
              aria-labelledby="install-app-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.closeButton}
                aria-label={t("common.closeInstallHelp")}
                onClick={() => setShowHelp(false)}
              >
                ×
              </button>
              <span className={styles.dialogIcon} aria-hidden="true">
                ⇩
              </span>
              <h2 id="install-app-title">{t("common.installTitle")}</h2>
              <p>{t(instructionKey())}</p>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
