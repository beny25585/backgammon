import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { Color, GameState } from "../../lib/backgammon/engine";
import BoardHalfOverlay from "../Board/BoardHalfOverlay";
import { BOARD_DICE_THROW_MS } from "../animations/RollingDie/boardDiceFlight";
import DiceOverlay from "./DiceOverlay";

const COLORS = ["white", "black"] as const;

function isOpening(phase: GameState["phase"]) {
  return phase === "opening_roll" || phase === "opening_result";
}

interface OpeningSnapshot {
  scope: string;
  phase: GameState["phase"];
  playerColor: Color;
  white: number | null;
  black: number | null;
  tie: boolean;
}

type VisibleDice = Record<Color, { value: number; throwOnBoard: boolean } | null>;

function openingFaces(snapshot: OpeningSnapshot): VisibleDice {
  return {
    white: snapshot.white === null ? null : { value: snapshot.white, throwOnBoard: false },
    black: snapshot.black === null ? null : { value: snapshot.black, throwOnBoard: false },
  };
}

/** Display the deciding dice in their owners' halves, without driving the game. */
export default function OpeningDice({ state, playerColor, scope, readOnly }: {
  state: GameState;
  playerColor: Color;
  scope: string;
  readOnly: boolean;
}) {
  const { t, direction } = useI18n();
  const opening = isOpening(state.phase) && !readOnly;
  const snapshot: OpeningSnapshot = {
    scope,
    phase: state.phase,
    playerColor,
    white: opening ? state.openingRoll.white ?? null : null,
    black: opening ? state.openingRoll.black ?? null : null,
    tie: opening && state.phase === "opening_roll" &&
      state.openingRoll.white == null && state.openingRoll.black == null &&
      state.message.startsWith("Tie "),
  };
  const [view, setView] = useState(() => ({ snapshot, dice: openingFaces(snapshot), attempt: 0 }));
  const [dismissedTie, setDismissedTie] = useState<number | null>(null);
  const previous = view.snapshot;
  const orientationChanged = previous.playerColor !== playerColor;
  if (previous.scope !== scope || previous.phase !== snapshot.phase ||
    orientationChanged || previous.white !== snapshot.white || previous.black !== snapshot.black || previous.tie !== snapshot.tie) {
    const continuous = opening && previous.scope === scope && isOpening(previous.phase);
    const dice = openingFaces(snapshot);
    // The engine clears both fields after an explicit tie. A die we already saw
    // is enough to know the matching face; a tie snapshot alone supplies none.
    const knownTieFace = continuous && snapshot.tie ? previous.white ?? previous.black : null;
    const attempt = continuous && !previous.tie ? view.attempt : view.attempt + 1;
    if (continuous) {
      for (const color of COLORS) {
        const value = knownTieFace ?? snapshot[color];
        if (value === null) continue;
        if (attempt === view.attempt && previous[color] === value) {
          // Hot-seat can flip the board during the deciding roll. Settle the old die in its new slot.
          dice[color] = orientationChanged ? { value, throwOnBoard: false } : view.dice[color];
        } else {
          dice[color] = { value, throwOnBoard: true };
        }
      }
    }
    setView({ snapshot, dice, attempt });
  }

  const showingTie = view.snapshot.tie && view.attempt !== dismissedTie;
  useEffect(() => {
    if (!showingTie) return;
    const timer = window.setTimeout(() => setDismissedTie(view.attempt), BOARD_DICE_THROW_MS + 250);
    return () => window.clearTimeout(timer);
  }, [showingTie, view.attempt]);

  if (!opening) return null;
  const deciding = state.phase === "opening_result";
  return (
    <>
      {(!view.snapshot.tie || showingTie) && COLORS.map(color => {
        const die = view.dice[color];
        if (!die) return null;
        return (
          <BoardHalfOverlay key={`${view.attempt}:${color}`} side={color === playerColor ? "right" : "left"}>
            <DiceOverlay kind="opening" dice={[die.value]} remaining={[die.value]} color={color}
              playerColor={playerColor} throwOnBoard={die.throwOnBoard} settled={!die.throwOnBoard} />
          </BoardHalfOverlay>
        );
      })}
      {(deciding || showingTie) && (
        <div data-testid={deciding ? "opening-result-overlay" : "opening-tie-status"}
          dir={direction} role="status"
          className="pointer-events-none z-40 col-span-full row-start-1 mt-1.5 max-w-[85%] self-start justify-self-center rounded-lg border border-[var(--ui-accent-border,#dfaf635c)] bg-[var(--ui-secondary-bg,#211810)] px-3 py-1.5 text-center text-xs font-bold text-[var(--ui-accent,#dfaf63)] shadow-[0_3px_9px_#0007]">
          {t(deciding ? state.turn === playerColor ? "game.youFirst" : "game.opponentFirst" : "game.openingRollTie")}
        </div>
      )}
    </>
  );
}
