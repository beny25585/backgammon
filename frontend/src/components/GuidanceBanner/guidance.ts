import { allLegalMoves, getForcedMove } from "@/lib/backgammon/engine";
import type { Color, GameState } from "@/lib/backgammon/engine";

export type GuidanceVariant =
  | "roll" // your turn — tap to roll (opening or normal)
  | "move" // your turn — tap a checker to move
  | "opponent" // opponent is thinking / waiting
  | "double" // opponent offered a double — respond
  | "opening" // opening-roll result
  | "no-moves" // no moves available — turn passes
  | "forced" // only one legal placement — auto-playing
  | "confirm"; // your turn — all dice used

export interface Guidance {
  variant: GuidanceVariant;
  text: string;
  dice: number[];
  remaining: number[];
  interactive: "roll" | "double" | null;
}

const NO_DICE: number[] = [];

export function getGuidance(
  state: GameState,
  playerColor: Color,
): Guidance | null {
  const isMyTurn = state.turn === playerColor;

  if (state.phase === "game_over") return null;

  if (state.phase === "waiting") {
    return {
      variant: "opponent",
      text: "Waiting to start",
      dice: NO_DICE,
      remaining: NO_DICE,
      interactive: null,
    };
  }

  if (state.phase === "opening_roll") {
    return isMyTurn
      ? {
          variant: "roll",
          text: "Roll to start",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "roll",
        }
      : {
          variant: "opponent",
          text: "Waiting for opponent's roll",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "opening_result") {
    return isMyTurn
      ? {
          variant: "opening",
          text: "You go first!",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        }
      : {
          variant: "opening",
          text: "Opponent goes first",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "doubling_offered") {
    const offered = state.doubleOfferedBy;
    return offered !== null && offered !== playerColor
      ? {
          variant: "double",
          text: "Opponent offers a double!",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "double",
        }
      : {
          variant: "opponent",
          text: "Waiting for their response",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "rolling") {
    return isMyTurn
      ? {
          variant: "roll",
          text: "Your turn — tap to roll",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "roll",
        }
      : {
          variant: "opponent",
          text: "Opponent is thinking…",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "moving") {
    if (!isMyTurn) {
      return {
        variant: "opponent",
        text: "Opponent is thinking…",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (state.remaining.length === 0) {
      return {
        variant: "confirm",
        text: "Confirm your turn",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (allLegalMoves(state, playerColor).length === 0) {
      return {
        variant: "no-moves",
        text: "No moves available — turn passes",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (getForcedMove(state, playerColor) !== null) {
      return {
        variant: "forced",
        text: "Forced move — playing automatically",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    return {
      variant: "move",
      text: "Your turn — tap a checker to move",
      dice: state.dice,
      remaining: state.remaining,
      interactive: null,
    };
  }

  return {
    variant: "opponent",
    text: "Waiting…",
    dice: NO_DICE,
    remaining: NO_DICE,
    interactive: null,
  };
}
