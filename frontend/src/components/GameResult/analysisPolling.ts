// Coalesce work, never private results: another component waits instead of
// sharing a response that could belong to an earlier authenticated session.
const inFlight = new Set<string>();
const unavailableUntil = new Map<string, number>();

export class AnalysisDeferred extends Error {
  constructor(public readonly delayMs: number) { super('Analysis request deferred'); }
}

export async function fetchAnalysis(url: string, signal: AbortSignal) {
  const origin = new URL(url).origin;
  const remaining = (unavailableUntil.get(origin) ?? 0) - Date.now();
  if (remaining > 0) throw new AnalysisDeferred(remaining);
  if (inFlight.has(url)) throw new AnalysisDeferred(1000);
  inFlight.add(url);
  try {
    const response = await fetch(url, { credentials: 'include', signal });
    if (response.status === 503 || response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const delayMs = Math.min(300_000, Math.max(30_000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 30_000));
      unavailableUntil.set(origin, Date.now() + delayMs);
    } else if (response.ok) unavailableUntil.delete(origin);
    return response;
  } finally { inFlight.delete(url); }
}
