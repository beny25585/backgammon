import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const DOUBLE_WINDOW_MS = 10_000;

interface Options {
  turnKey: string | null;
  autoRoll: boolean;
  canDouble: boolean;
  blockedOnBar: boolean;
  paused: boolean;
  hasError: boolean;
  rollDice: () => void;
  offerDouble: () => void;
}

/** Coordinate automatic and manual pre-roll actions for a single turn. */
export function useTurnRollActions({
  turnKey, autoRoll, canDouble, blockedOnBar, paused, hasError, rollDice, offerDouble,
}: Options) {
  const requestedActionRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const actionsRef = useRef({ rollDice, offerDouble });
  const [countdown, setCountdown] = useState<{ turnKey: string; seconds: number } | null>(null);

  // Updated callbacks must not restart an already running decision window.
  useLayoutEffect(() => {
    actionsRef.current = { rollDice, offerDouble };
  }, [rollDice, offerDouble]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  // Cancel before another browser task can invoke an old turn's callback using
  // the newly committed room's actions. Passive-effect cleanup alone is too late.
  useLayoutEffect(() => cancelTimer,
    [autoRoll, blockedOnBar, turnKey, paused, hasError, canDouble, cancelTimer]);

  useEffect(() => {
    // Preserve the in-flight guard when StrictMode replays the effects.
    if (!turnKey || hasError) requestedActionRef.current = null;
  }, [turnKey, hasError]);

  const handleRoll = useCallback(() => {
    if (!turnKey || paused || requestedActionRef.current === turnKey) return;
    cancelTimer();
    requestedActionRef.current = turnKey;
    setCountdown(null);
    actionsRef.current.rollDice();
  }, [turnKey, paused, cancelTimer]);

  const handleOfferDouble = useCallback(() => {
    if (!turnKey || !canDouble || paused || requestedActionRef.current === turnKey) return;
    // A remote double offer leaves the state in rolling until the server replies.
    // Stop the timer at the click, rather than waiting for that state update.
    cancelTimer();
    requestedActionRef.current = turnKey;
    setCountdown(null);
    actionsRef.current.offerDouble();
  }, [turnKey, canDouble, paused, cancelTimer]);

  useEffect(() => {
    if ((!autoRoll && !blockedOnBar) || !turnKey || paused || hasError ||
      requestedActionRef.current === turnKey) return;

    // A fully closed bar passes immediately; an unavailable double needs no window.
    if (blockedOnBar || !canDouble) {
      handleRoll();
      return;
    }

    const deadline = Date.now() + DOUBLE_WINDOW_MS;
    const updateCountdown = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        handleRoll();
        return;
      }
      setCountdown({ turnKey, seconds: Math.ceil(remaining / 1000) });
      timerRef.current = window.setTimeout(updateCountdown, Math.min(1000, remaining));
    };
    timerRef.current = window.setTimeout(updateCountdown, 0);
    return cancelTimer;
  }, [autoRoll, blockedOnBar, turnKey, paused, hasError, canDouble, handleRoll, cancelTimer]);

  const countdownSeconds = autoRoll && canDouble && !blockedOnBar && !paused && !hasError &&
    countdown?.turnKey === turnKey ? countdown.seconds : null;

  return { handleRoll, handleOfferDouble, countdownSeconds };
}
