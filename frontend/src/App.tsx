import Router from "./router";
import { LanguageSwitcher } from "./components/LanguageSwitcher/LanguageSwitcher";
import { useI18n } from "./i18n/I18nProvider";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function App() {
  const { direction } = useI18n();
  const location = useLocation();
  const isGameRoute =
    location.pathname === "/local" || location.pathname.startsWith("/game/");

  useEffect(() => {
    function syncViewportHeight() {
      document.documentElement.style.setProperty(
        "--app-height",
        `${window.innerHeight}px`,
      );
    }

    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    window.visualViewport?.addEventListener("resize", syncViewportHeight);

    return () => {
      window.removeEventListener("resize", syncViewportHeight);
      window.visualViewport?.removeEventListener("resize", syncViewportHeight);
    };
  }, []);

  return (
    <div dir={direction}>
      {!isGameRoute && (
        <div style={{ position: "fixed", top: 12, insetInlineEnd: 12, zIndex: 1000 }}>
          <LanguageSwitcher />
        </div>
      )}
      <Router />
    </div>
  );
}
