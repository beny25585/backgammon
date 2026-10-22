import { useCallback, useEffect, useRef, useState } from "react";
import type { NoMovesMessage } from "../types/context";

export const NO_MOVES_DISPLAY_MS = 3000;
const NOTICE_REVEAL_MS = 350;

/** Keep the rolled dice visible while the authoritative game can advance. */
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
    message: Omit<NoMovesMessage, "noticeVisible">,
    revealAfterMs = NOTICE_REVEAL_MS,
    eventVersion?: number,
  ) => {
    const key = JSON.stringify([scope, eventVersion, message]);
    if (activeKey.current === key) return;
    cancelTimers();
    activeKey.current = key;
    const id = generation.current;
    const snapshot = { ...message, id: `${scope}:${id}` };
    setNotice({ scope, message: { ...snapshot, noticeVisible: false } });
    timers.current = [
      setTimeout(() => {
        if (generation.current !== id) return;
        setNotice({ scope, message: { ...snapshot, noticeVisible: true } });
      }, Math.min(Math.max(0, revealAfterMs), NO_MOVES_DISPLAY_MS)),
      setTimeout(() => {
        if (generation.current !== id) return;
        activeKey.current = null;
        setNotice(null);
      }, NO_MOVES_DISPLAY_MS),
    ];
  }, [scope, cancelTimers]);

  return {
    noMovesMessage: notice?.scope === scope ? notice.message : null,
    revealNoMoves,
    clearNoMoves,
  };
}
