import { useEffect, useRef } from "react";
import { matchPath } from "react-router-dom";

const BUILD_VERSION =
  typeof __BACKGAMMON_BUILD_VERSION__ === "string" ? __BACKGAMMON_BUILD_VERSION__ : "";
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");
const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const CHECK_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RELOAD_KEY = "6b-game-build-reload";
const VERSION_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function isSafeGameRoute(pathname: string) {
  return Boolean(matchPath("/history", pathname) || matchPath("/history/:id", pathname));
}

function canReloadNow() {
  const { pathname } = window.location;
  if (BASE_PATH && !pathname.toLowerCase().startsWith(`${BASE_PATH.toLowerCase()}/`)) return false;
  return document.visibilityState === "visible" && isSafeGameRoute(pathname.slice(BASE_PATH.length));
}

function recordReload(version: string) {
  try {
    const [previousVersion, previousTime] = (sessionStorage.getItem(RELOAD_KEY) ?? "").split(":");
    const now = Date.now();
    if (previousVersion === version && now - Number(previousTime) < CHECK_INTERVAL_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, `${version}:${now}`);
    return true;
  } catch {
    return false;
  }
}

function reloadPage() {
  window.location.reload();
}

export function useGameBuildUpdate(
  pathname: string,
  currentVersion = BUILD_VERSION,
  reload = reloadPage,
) {
  const reloading = useRef(false);

  useEffect(() => {
    if (!currentVersion || !isSafeGameRoute(pathname)) return;
    let request: AbortController | undefined;

    async function checkVersion() {
      if (request || reloading.current || !canReloadNow()) return;
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(VERSION_URL, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;

        const marker: unknown = await response.json();
        if (!marker || typeof marker !== "object" || !("version" in marker)) return;
        const { version } = marker;
        if (typeof version !== "string" || !VERSION_PATTERN.test(version) || version === currentVersion) return;

        // The player may have entered a room while the request was pending.
        if (controller.signal.aborted || !canReloadNow() || !recordReload(version)) return;
        reloading.current = true;
        reload();
      } catch {
        // Check again on the next interval or when the page returns to the foreground.
      } finally {
        window.clearTimeout(timeout);
        request = undefined;
      }
    }

    const probe = () => void checkVersion();
    const interval = window.setInterval(probe, CHECK_INTERVAL_MS);
    window.addEventListener("pageshow", probe);
    window.addEventListener("focus", probe);
    window.addEventListener("online", probe);
    document.addEventListener("visibilitychange", probe);
    probe();

    return () => {
      request?.abort();
      window.clearInterval(interval);
      window.removeEventListener("pageshow", probe);
      window.removeEventListener("focus", probe);
      window.removeEventListener("online", probe);
      document.removeEventListener("visibilitychange", probe);
    };
  }, [pathname, currentVersion, reload]);
}
