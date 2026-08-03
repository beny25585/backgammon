const API_URL = import.meta.env.VITE_SERVER_URL?.replace('ws', 'http') ?? '';

function sendLog(level: string, message: string, meta: Record<string, unknown> = {}) {
  try {
    fetch(`${API_URL}/api/client-log/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, meta }),
    }).catch(() => {});
  } catch {
    // best-effort logging; never throw
  }
}

export const clientLogger = {
  info: (message: string, meta?: Record<string, unknown>) => sendLog('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => sendLog('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => sendLog('error', message, meta),
};
