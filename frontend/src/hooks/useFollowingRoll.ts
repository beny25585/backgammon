import { useState } from "react";
import type { GameState } from "../lib/backgammon/engine";
import type { NoMovesMessage, RollSnapshot } from "../types/context";

/** Retain the next player's roll for the current notice, even after their moves. */
export function useFollowingRoll(state: GameState, notice?: NoMovesMessage | null) {
  const key = notice
    ? notice.id ?? JSON.stringify([notice.color, notice.dice, notice.remaining])
    : null;
  const current: RollSnapshot | null = notice && state.phase === "moving" &&
    state.turn !== notice.color && state.dice.length > 0
    ? { color: state.turn, dice: [...state.dice] }
    : null;
  const [saved, setSaved] = useState<{ key: string | null; roll: RollSnapshot | null }>({ key, roll: current });

  // Adjust only when the notice or rolled values change; remaining dice are live state.
  if (saved.key !== key || (current && (saved.roll?.color !== current.color ||
    saved.roll.dice.join(",") !== current.dice.join(",")))) {
    setSaved({ key, roll: current });
  }

  return notice?.followingRoll ?? current ?? (saved.key === key ? saved.roll : null);
}
