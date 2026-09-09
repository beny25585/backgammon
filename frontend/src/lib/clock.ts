import type { GameState, Color } from "./backgammon/engine";

export interface TimeControl {
  base: number; // starting reserve per player, ms
  delay: number; // free seconds per turn before the reserve drains, ms
}

export interface TimeControlPreset {
  id: string;
  label: string;
  secondsPerPoint: number;
  delay: number;
}

export const TIME_CONTROL_PRESETS: TimeControlPreset[] = [
  { id: "none", label: "No limit", secondsPerPoint: 0, delay: 0 },
  { id: "fast", label: "Fast", secondsPerPoint: 30, delay: 10_000 },
  { id: "normal", label: "Normal", secondsPerPoint: 60, delay: 10_000 },
  { id: "slow", label: "Slow", secondsPerPoint: 120, delay: 10_000 },
];

export function parseTimeControl(
  id: string | null | undefined,
  targetPoints = 1,
): TimeControl | null {
  if (!id || id === "none") return null;
  const preset = TIME_CONTROL_PRESETS.find((p) => p.id === id);
  if (preset) {
    const target = Number.isFinite(targetPoints)
      ? Math.max(1, Math.trunc(targetPoints))
      : 1;
    return {
      base: preset.secondsPerPoint * target * 1_000,
      delay: preset.delay,
    };
  }
  // Legacy "M+S" ids from previously stored rooms still parse.
  const [minutes, delaySec] = id.split("+").map((n) => parseInt(n, 10));
  if (!Number.isFinite(minutes) || !Number.isFinite(delaySec)) return null;
  return { base: minutes * 60_000, delay: delaySec * 1_000 };
}

export function activePlayerOf(state: GameState | null): Color | null {
  if (!state) return null;
  if (
    state.phase === "waiting" ||
    state.phase === "game_over" ||
    state.phase === "opening_roll" ||
    state.phase === "opening_result"
  ) {
    return null;
  }
  if (state.phase === "doubling_offered" && state.doubleOfferedBy) {
    return state.doubleOfferedBy === "white" ? "black" : "white";
  }
  return state.turn;
}

export function applyClockTransition(
  clock: Record<Color, number>,
  prevActive: Color | null,
  newActive: Color | null,
  elapsedMs: number,
  delayMs: number,
): Record<Color, number> {
  if (!prevActive || prevActive === newActive) return { ...clock };
  const charged = Math.max(0, elapsedMs - delayMs);
  return {
    ...clock,
    [prevActive]: Math.max(0, clock[prevActive] - charged),
  };
}

/** Reserve ms still available for the active player, accounting for the delay. */
export function reserveLeft(
  clock: Record<Color, number>,
  active: Color | null,
  turnStartedAt: number | null | undefined,
  nowMs: number,
  delayMs: number,
): number {
  if (!active) return 0;
  if (turnStartedAt == null) return clock[active] ?? 0;
  const charged = Math.max(0, nowMs - turnStartedAt - delayMs);
  return Math.max(0, (clock[active] ?? 0) - charged);
}

/** Delay ms remaining for the current turn (the "extra time for the play"). */
export function delayLeft(
  active: Color | null,
  turnStartedAt: number | null | undefined,
  nowMs: number,
  delayMs: number,
): number {
  if (!active || turnStartedAt == null) return 0;
  return Math.max(0, delayMs - (nowMs - turnStartedAt));
}

export function formatClock(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
