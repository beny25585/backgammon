import type { GameState } from "../lib/backgammon/engine";

export type SpectatorError = "full" | "expired" | "unavailable" | "ended" | "forbidden";
export type SpectatorStatus = "connecting" | "live" | "reconnecting" | "ended" | "error";

export interface SpectatorMeta {
  whiteName: string;
  blackName: string;
  targetPoints: number;
  matchScore: { white: number; black: number };
  timeControl: string;
}

export interface SpectatorSnapshot {
  state: GameState;
  meta: SpectatorMeta;
}

const phases = new Set(["waiting", "opening_roll", "opening_result", "rolling", "moving", "doubling_offered", "game_over"]);
const color = (value: unknown) => value === "white" || value === "black";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const pair = (value: unknown): value is { white: number; black: number } => record(value) && count(value.white) && count(value.black);
const dice = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 4 && value.every(die => Number.isInteger(die) && die >= 1 && die <= 6);

/** Validate the public wire shape before handing a board snapshot to the renderer. */
export function readSpectatorSnapshot(payload: unknown, meta: unknown): SpectatorSnapshot | null {
  if (!record(payload) || !record(meta)) return null;
  if (!Array.isArray(payload.points) || payload.points.length !== 24 || !payload.points.every(point => Number.isInteger(point) && Math.abs(point) <= 15)) return null;
  if (!pair(payload.bar) || !pair(payload.home) || !color(payload.turn) || !phases.has(String(payload.phase))) return null;
  if (!dice(payload.dice) || !dice(payload.remaining) || !count(payload.cube) || Number(payload.cube) < 1) return null;
  if (payload.cubeOwner !== "center" && !color(payload.cubeOwner)) return null;
  if (!record(payload.openingRoll) || ![payload.openingRoll.white, payload.openingRoll.black].every(die => die === null || (Number.isInteger(die) && Number(die) >= 1 && Number(die) <= 6))) return null;
  if (!count(payload.version) || (payload.clock != null && !pair(payload.clock))) return null;
  if (payload.turnStartedAt != null && (typeof payload.turnStartedAt !== "number" || !Number.isFinite(payload.turnStartedAt))) return null;
  if (payload.winner != null && !color(payload.winner)) return null;
  if (payload.doubleOfferedBy != null && !color(payload.doubleOfferedBy)) return null;
  if (payload.lastMove != null && (!Array.isArray(payload.lastMove) || !payload.lastMove.every(move => record(move)
    && (move.from === "bar" || (count(move.from) && move.from < 24))
    && (move.to === "off" || (count(move.to) && move.to < 24))))) return null;
  if (typeof meta.whiteName !== "string" || typeof meta.blackName !== "string" || !count(meta.targetPoints) || meta.targetPoints < 1
    || !pair(meta.matchScore) || typeof meta.timeControl !== "string") return null;
  return {
    state: { ...payload, moveHistory: null, message: "", lastMove: payload.lastMove ?? null,
      winner: payload.winner ?? null, doubleOfferedBy: payload.doubleOfferedBy ?? null, winType: payload.winType ?? null } as unknown as GameState,
    meta: meta as unknown as SpectatorMeta,
  };
}
