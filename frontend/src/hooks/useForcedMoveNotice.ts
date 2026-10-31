import { useEffect, useRef, useState } from "react";
import type { GuidanceMessage } from "../components/GuidanceBanner/GuidanceBanner";
import type { Color, GameState } from "../lib/backgammon/engine";

const DISPLAY_MS = 3000;

interface Options {
  state: GameState;
  playerColor: Color;
  scope: string;
  eligible: boolean;
  suppressed: boolean;
}

interface NoticeSnapshot {
  scope: string;
  playerColor: Color;
  message: GuidanceMessage;
}

/** A forced move is an event: later moves do not shorten or restart its notice. */
export function useForcedMoveNotice({ state, playerColor, scope, eligible, suppressed }: Options): GuidanceMessage | null {
  const [notice, setNotice] = useState<NoticeSnapshot | null>(null);
  const tracking = useRef({
    scope,
    playerColor,
    ownMoving: false,
    turnStartedAt: state.turnStartedAt,
    diceKey: "",
    handled: false,
    sequence: 0,
    notice: null as NoticeSnapshot | null,
  });
  const ownMoving = state.turn === playerColor && state.phase === "moving";
  const hasPlayedMove = (state.lastMove?.length ?? 0) > 0;
  const diceKey = [...state.dice].sort((a, b) => a - b).join(",");
  const reset = state.phase === "waiting" || state.phase === "opening_roll" ||
    state.phase === "opening_result" || state.phase === "game_over";

  useEffect(() => {
    const current = tracking.current;
    const scopeChanged = current.scope !== scope || current.playerColor !== playerColor;
    const newRoll = ownMoving && (
      !current.ownMoving ||
      (state.turnStartedAt !== undefined && state.turnStartedAt !== current.turnStartedAt) ||
      (!hasPlayedMove && diceKey !== current.diceKey)
    );

    if (scopeChanged || reset || newRoll) {
      current.handled = false;
      current.notice = null;
    }
    current.scope = scope;
    current.playerColor = playerColor;
    current.ownMoving = ownMoving;
    current.turnStartedAt = state.turnStartedAt;
    current.diceKey = diceKey;

    if (suppressed) current.notice = null;
    if (!reset && !suppressed && eligible && !current.handled) {
      current.handled = true;
      current.sequence += 1;
      current.notice = {
        scope,
        playerColor,
        message: {
          id: `${scope}:${playerColor}:forced:${current.sequence}`,
          expiresAt: Date.now() + DISPLAY_MS,
          variant: "forced",
          textKey: "guidance.forced",
        },
      };
    }

    const snapshot = current.notice;
    setNotice(snapshot);
    if (!snapshot) return;
    const remainingMs = Math.max(0, snapshot.message.expiresAt! - Date.now());
    const timer = window.setTimeout(() => {
      if (tracking.current.notice !== snapshot) return;
      tracking.current.notice = null;
      setNotice(currentNotice => currentNotice === snapshot ? null : currentNotice);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [scope, playerColor, ownMoving, state.turnStartedAt, hasPlayedMove, diceKey, reset, eligible, suppressed]);

  if (reset || suppressed || notice?.scope !== scope || notice.playerColor !== playerColor) return null;
  return notice.message;
}
