function getServerUrl(): string {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const raw = env?.VITE_SERVER_URL;
  return raw?.replace("ws", "http") ?? "";
}

const API_URL = getServerUrl();
const verboseLogging =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_CLIENT_LOG_VERBOSE === "true";
const enabledLevels = new Set(["warn", "error"]);
function sendLog(
  level: string,
  message: string,
  meta: Record<string, unknown> = {},
) {
  if (!verboseLogging && !enabledLevels.has(level)) return;

  const clientEpochMs = Date.now();
  const clientPerfMs =
    typeof performance !== "undefined" ? Math.round(performance.now()) : null;

  try {
    fetch(`${API_URL}/api/client-log/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level,
        message,
        meta: {
          ...meta,
          clientEpochMs,
          clientPerfMs,
        },
      }),
    }).catch(() => {});
  } catch {
    // best-effort logging; never throw
  }
}
export const clientLogger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    sendLog("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    sendLog("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    sendLog("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    sendLog("error", message, meta),
};
