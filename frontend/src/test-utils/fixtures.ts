import type { GameState } from "../lib/backgammon/engine";
import { newGame } from "../lib/backgammon/engine";

export const newGameFixture: GameState = newGame();

export const midGameFixture: GameState = {
  ...newGame(),
  phase: "moving",
  turn: "white",
  dice: [4, 3],
  remaining: [4, 3],
  lastMove: [],
  moveHistory: [],
  message: "White — make a move",
};

export const openingRollWhiteFixture: GameState = {
  ...newGame(),
  phase: "opening_roll",
  turn: "black",
  openingRoll: { white: 5, black: null },
  message: "Waiting for opponent's roll",
};

export const noMovesFixture: GameState = {
  ...newGame(),
  phase: "moving",
  turn: "white",
  dice: [1, 1],
  remaining: [1, 1],
  lastMove: [],
  moveHistory: [],
  message: "No legal moves",
};

export const doubleOfferedFixture: GameState = {
  ...newGame(),
  phase: "doubling_offered",
  turn: "black",
  doubleOfferedBy: "white",
  cube: 2,
  message: "White offers a double",
};

export const gameOverFixture: GameState = {
  ...newGame(),
  phase: "game_over",
  winner: "white",
  winType: "gammon",
  cube: 2,
  message: "Game over",
};

export const barFixture: GameState = {
  ...newGame(),
  phase: "moving",
  turn: "white",
  dice: [6, 5],
  remaining: [6, 5],
  bar: { white: 1, black: 0 },
  lastMove: [],
  moveHistory: [],
  message: "White — make a move",
};
