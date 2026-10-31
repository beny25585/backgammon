import { useCallback, useEffect, useRef, useState } from "react";
import type { NoMovesMessage } from "../types/context";
import type { GameState } from "../lib/backgammon/engine";

export const NO_MOVES_DISPLAY_MS = 3000;
const NOTICE_REVEAL_MS = 350;

/** Show a blocked-turn notice, keeping any real dice separate from unrolled passes. */
export function useNoMovesNotice(scope: string) {
  const [notice, setNotice] = useState<{
    scope: string;
    message: NoMovesMessage;
  } | null>(null);
  const generation = useRef(0);
  const activeKey = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelTimers = useCallback(() => {
    generation.current += 1;
    activeKey.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => cancelTimers, [scope, cancelTimers]);

  const clearNoMoves = useCallback(() => {
    cancelTimers();
    setNotice(null);
  }, [cancelTimers]);

  const revealNoMoves = useCallback((
    message: Pick<NoMovesMessage, "kind" | "color" | "dice" | "remaining">,
    revealAfterMs = NOTICE_REVEAL_MS,
    eventVersion?: number,
  ) => {
    const key = JSON.stringify([scope, eventVersion, message]);
    if (activeKey.current === key) return;
    cancelTimers();
    activeKey.current = key;
    const id = generation.current;
    const snapshot = {
      ...message,
      dice: [...message.dice],
      remaining: [...message.remaining],
      id: `${scope}:${id}`,
      expiresAt: Date.now() + NO_MOVES_DISPLAY_MS,
    };
    setNotice({ scope, message: { ...snapshot, noticeVisible: false } });
    timers.current = [
      setTimeout(() => {
        if (generation.current !== id) return;
        setNotice(current => current?.message.id === snapshot.id
          ? { ...current, message: { ...current.message, noticeVisible: true } }
          : current);
      }, Math.min(Math.max(0, revealAfterMs), NO_MOVES_DISPLAY_MS)),
      setTimeout(() => {
        if (generation.current !== id) return;
        activeKey.current = null;
        setNotice(null);
      }, NO_MOVES_DISPLAY_MS),
    ];
  }, [scope, cancelTimers]);

  // Capture every accepted roll before React can batch it with completed moves.
  const captureFollowingRoll = useCallback((state: GameState) => {
    if (state.phase !== "moving" || state.dice.length === 0) return;
    const roll = { color: state.turn, dice: [...state.dice] };
    setNotice(current => {
      if (current?.scope !== scope || current.message.color === roll.color) return current;
      const saved = current.message.followingRoll;
      if (saved?.color === roll.color && saved.dice.join(",") === roll.dice.join(",")) return current;
      return { ...current, message: { ...current.message, followingRoll: roll } };
    });
  }, [scope]);

  return {
    noMovesMessage: notice?.scope === scope ? notice.message : null,
    revealNoMoves,
    clearNoMoves,
    captureFollowingRoll,
  };
}
