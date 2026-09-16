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
  textKey: string;
  text?: string;
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
      textKey: "guidance.waitingStart",
      dice: NO_DICE,
      remaining: NO_DICE,
      interactive: null,
    };
  }

  if (state.phase === "opening_roll") {
    return isMyTurn
      ? {
          variant: "roll",
          textKey: "guidance.rollStart",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "roll",
        }
      : {
          variant: "opponent",
          textKey: "guidance.waitingRoll",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "opening_result") {
    return isMyTurn
      ? {
          variant: "opening",
          textKey: "guidance.youFirst",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        }
      : {
          variant: "opening",
          textKey: "guidance.opponentFirst",
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
          textKey: "guidance.double",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "double",
        }
      : {
          variant: "opponent",
          textKey: "guidance.waitingResponse",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "rolling") {
    return isMyTurn
      ? {
          variant: "roll",
          textKey: "guidance.roll",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: "roll",
        }
      : {
          variant: "opponent",
          textKey: "guidance.opponent",
          dice: NO_DICE,
          remaining: NO_DICE,
          interactive: null,
        };
  }

  if (state.phase === "moving") {
    if (!isMyTurn) {
      return {
        variant: "opponent",
        textKey: "guidance.opponent",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (state.remaining.length === 0) {
      return {
        variant: "confirm",
        textKey: "guidance.confirm",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (allLegalMoves(state, playerColor).length === 0) {
      return {
        variant: "no-moves",
        textKey: "guidance.noMoves",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    if (getForcedMove(state, playerColor) !== null) {
      return {
        variant: "forced",
        textKey: "guidance.forced",
        dice: NO_DICE,
        remaining: NO_DICE,
        interactive: null,
      };
    }
    return {
      variant: "move",
      textKey: "guidance.move",
      dice: state.dice,
      remaining: state.remaining,
      interactive: null,
    };
  }

  return {
    variant: "opponent",
    textKey: "guidance.waiting",
    dice: NO_DICE,
    remaining: NO_DICE,
    interactive: null,
  };
}
