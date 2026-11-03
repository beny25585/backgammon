import type { Color } from "../types/game";

export const REACTION_DISPLAY_MS = 4000;
export const REACTION_COOLDOWN_MS = 3000;

export const PLAYER_REACTIONS = [
  { id: "good_luck", emoji: undefined },
  { id: "nice_move", emoji: undefined },
  { id: "thanks", emoji: undefined },
  { id: "well_played", emoji: undefined },
  { id: "good_game", emoji: undefined },
  { id: "thumbs_up", emoji: "👍" },
  { id: "clap", emoji: "👏" },
  { id: "smile", emoji: "😄" },
  { id: "thinking", emoji: "🤔" },
  { id: "sweat_smile", emoji: "😅" },
  { id: "dice", emoji: "🎲" },
] as const;

export type PlayerReactionId = typeof PLAYER_REACTIONS[number]["id"];
export type ReactionError = "cooldown" | "unavailable" | "invalid";

export interface PlayerReaction {
  id: string;
  roomId: string;
  reactionId: PlayerReactionId;
  color: Color;
  /** Local deadline derived from the server's remaining lifetime, allowing clock skew. */
  expiresAt: number;
}

const reactionIds = new Set<string>(PLAYER_REACTIONS.map(({ id }) => id));

export function isPlayerReactionId(value: unknown): value is PlayerReactionId {
  return typeof value === "string" && reactionIds.has(value);
}
