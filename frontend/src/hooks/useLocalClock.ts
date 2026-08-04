import { useEffect, useRef, useState } from "react";
import type { GameState, Color } from "../lib/backgammon/engine";
import { activePlayerOf, applyClockTransition, type TimeControl } from "../lib/clock";

const TICK_MS = 250;

/**
 * Client-side simple-delay clock for local/AI mode. Mirrors the server's
 * backend/game/clock.py: the reserve is only charged for time spent beyond the
 * per-turn delay on a turn change, and `turnStartedAt` tracks when the current
 * turn began so the UI can show the delay countdown.
 */
export function useLocalClock(
  state: GameState,
  timeControl: TimeControl | null,
  onTimeout: (color: Color) => void,
): { clock: Record<Color, number> | null; turnStartedAt: number | null } {
  const [clock, setClock] = useState<Record<Color, number> | null>(() =>
    timeControl ? { white: timeControl.base, black: timeControl.base } : null,
  );
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const activeRef = useRef<Color | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);
  const clockRef = useRef(clock);
  const prevPhaseRef = useRef<string | null>(null);
  const timedOutRef = useRef<Color | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  // No limit -> no clock.
  useEffect(() => {
    if (!timeControl) {
      setClock(null);
      setTurnStartedAt(null);
      activeRef.current = null;
      turnStartedAtRef.current = null;
      timedOutRef.current = null;
      return;
    }
    setClock({ white: timeControl.base, black: timeControl.base });
    setTurnStartedAt(null);
    activeRef.current = null;
    turnStartedAtRef.current = null;
    timedOutRef.current = null;
  }, [timeControl]);

  // New game (game over -> opening roll) -> restart both clocks.
  useEffect(() => {
    if (!timeControl) return;
    if (prevPhaseRef.current === "game_over" && state.phase === "opening_roll") {
      setClock({ white: timeControl.base, black: timeControl.base });
      setTurnStartedAt(null);
      turnStartedAtRef.current = null;
      timedOutRef.current = null;
    }
    prevPhaseRef.current = state.phase;
  }, [state.phase, timeControl]);

  // Active player changed -> charge the outgoing player beyond their delay.
  useEffect(() => {
    if (!timeControl) return;
    const active = activePlayerOf(state);
    const prev = activeRef.current;
    if (prev && active && prev !== active) {
      const elapsed = turnStartedAtRef.current != null ? Date.now() - turnStartedAtRef.current : 0;
      setClock((c) => (c ? applyClockTransition(c, prev, active, elapsed, timeControl.delay) : c));
      const started = Date.now();
      setTurnStartedAt(started);
      turnStartedAtRef.current = started;
    } else if (prev === null && active !== null && turnStartedAtRef.current === null) {
      const started = Date.now();
      setTurnStartedAt(started);
      turnStartedAtRef.current = started;
    }
    activeRef.current = active;
  }, [state, timeControl]);

  // Timeout ticker: fire when the active player's reserve hits zero.
  useEffect(() => {
    if (!timeControl) return;
    const id = setInterval(() => {
      const c = clockRef.current;
      if (!c) return;
      const active = activeRef.current;
      if (!active) return;
      const started = turnStartedAtRef.current;
      const elapsed = started != null ? Date.now() - started : 0;
      const reserve = c[active] - Math.max(0, elapsed - timeControl.delay);
      if (reserve <= 0 && timedOutRef.current === null) {
        timedOutRef.current = active;
        onTimeoutRef.current(active);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [timeControl]);

  return { clock, turnStartedAt };
}
