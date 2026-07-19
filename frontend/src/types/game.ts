import type { Color, Phase, GameState, Move } from "@/lib/backgammon/engine";

export type { Color, Phase, GameState, Move };

export interface PlayerState {
  color: Color;
  isCurrentPlayer: boolean;
  checkersOff: number;
  checkersOnBar: number;
}

export interface GameMessage {
  type:
    | "state_update"
    | "move_made"
    | "dice_rolled"
    | "double_offered"
    | "double_response"
    | "game_finished";
  payload: unknown;
}
