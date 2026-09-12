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
      // `innerHeight` is the layout viewport on mobile browsers. It can be
      // taller than the part of the page that is actually visible while the
      // address/navigation bars are showing, which leaves the bottom of the
      // board behind browser chrome. Prefer the visual viewport when it is
      // available so the complete game stays in view.
      const visualViewport = window.visualViewport;
      // Keep the game inside the smallest viewport the browser reports. This
      // also handles Android's system/navigation bars while a PWA is open.
      const visibleHeight = visualViewport
        ? Math.min(visualViewport.height, window.innerHeight)
        : window.innerHeight;
      const visibleWidth = visualViewport
        ? Math.min(visualViewport.width, window.innerWidth)
        : window.innerWidth;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.floor(visibleHeight)}px`,
      );
      document.documentElement.style.setProperty(
        "--app-width",
        `${Math.floor(visibleWidth)}px`,
      );
    }

    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    window.visualViewport?.addEventListener("resize", syncViewportHeight);
    window.visualViewport?.addEventListener("scroll", syncViewportHeight);

    return () => {
      window.removeEventListener("resize", syncViewportHeight);
      window.visualViewport?.removeEventListener("resize", syncViewportHeight);
      window.visualViewport?.removeEventListener("scroll", syncViewportHeight);
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
