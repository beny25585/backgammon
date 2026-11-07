import { useState } from "react";
import type { Color, GameState } from "../../lib/backgammon/engine";
import type { NoMovesMessage } from "../../types/context";

/** Match a full blocked-roll notice to a handoff just observed on this board. */
export function useBlockedDiceFlight(scope: string, state: GameState, notice?: NoMovesMessage | null) {
  const key = notice ? notice.id ?? JSON.stringify([notice.color, notice.dice, notice.remaining]) : null;
  const [previous, setPrevious] = useState<{
    scope: string;
    turn: Color;
    phase: GameState["phase"];
    key: string | null;
    passed: Color | null;
    flying: boolean;
  }>(() => ({ scope, turn: state.turn, phase: state.phase, key, passed: null, flying: false }));

  if (previous.scope !== scope || previous.phase !== state.phase ||
    previous.turn !== state.turn || previous.key !== key) {
    const sameGame = previous.scope === scope;
    const justPassed = sameGame && previous.phase === "rolling" && previous.turn !== state.turn &&
      (state.phase === "rolling" || state.phase === "moving");
    const passed = justPassed ? previous.turn : sameGame && previous.turn === state.turn ? previous.passed : null;
    const fullRoll = notice?.kind !== "blocked_pass" && notice?.dice.length === 2 &&
      notice.remaining.length === (notice.dice[0] === notice.dice[1] ? 4 : 2);
    const newNotice = previous.key !== key;
    const flying = sameGame && (newNotice
      ? fullRoll && passed === notice.color
      : previous.flying);
    setPrevious({
      scope, turn: state.turn, phase: state.phase, key,
      passed: newNotice && notice?.color === passed ? null : passed,
      flying,
    });
  }

  return previous.flying;
}
