import type { Color } from "../lib/backgammon/engine";

export interface PlayerDetails {
  rating: number;
  balance: string;
}

export interface RoomPlayerDetails {
  players: Partial<Record<Color, PlayerDetails | null>>;
}
