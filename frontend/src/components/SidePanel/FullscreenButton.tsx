import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

export default function FullscreenButton() {
  const { t } = useI18n();
  const [active, setActive] = useState(Boolean(document.fullscreenElement));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const update = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  if (!document.fullscreenEnabled) return null;
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else
        await (
          document.querySelector<HTMLElement>("[data-game-viewport]") ??
          document.documentElement
        ).requestFullscreen();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  const label = t(active ? "game.exitFullscreen" : "game.enterFullscreen");
  return (
    <>
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-lg border border-amber-200/25 bg-[#211e17] text-amber-200 hover:bg-[#393022] focus-visible:outline-2 focus-visible:outline-amber-300"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={toggle}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            d={
              active
                ? "M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5"
                : "M3 8V3h5m8 0h5v5M8 21H3v-5m18 0v5h-5"
            }
          />
        </svg>
      </button>
      {failed && (
        <span role="status" className="sr-only">
          {t("game.fullscreenUnavailable")}
        </span>
      )}
    </>
  );
}
