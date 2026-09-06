function getServerUrl(): string {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const raw = env?.VITE_SERVER_URL;
  return raw?.replace("ws", "http") ?? "";
}

const API_URL = getServerUrl();
const isDev = Boolean(
  (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.DEV,
);
const enabledLevels = new Set(["warn", "error"]);

function sendLog(
  level: string,
  message: string,
  meta: Record<string, unknown> = {},
) {
  if (!isDev && !enabledLevels.has(level)) return;

  try {
    fetch(`${API_URL}/api/client-log/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, message, meta }),
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
