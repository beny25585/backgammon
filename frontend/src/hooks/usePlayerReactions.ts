import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameSocketService } from "../services/socket";
import type { Color } from "../types/game";
import {
  isPlayerReactionId,
  REACTION_COOLDOWN_MS,
  REACTION_DISPLAY_MS,
  type PlayerReaction,
  type PlayerReactionId,
  type ReactionError,
} from "../lib/playerReactions";

interface Options {
  roomId: string;
  playerColor: Color;
  socket: Pick<GameSocketService, "send" | "isConnected">;
  enabled: boolean;
}

interface Snapshot {
  scope: string;
  reactions: Partial<Record<Color, PlayerReaction>>;
  cooldownUntil: number;
  error: ReactionError | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function payloadOf(message: unknown, type: string) {
  const envelope = record(message);
  return envelope?.type === type ? record(envelope.payload) : null;
}

/** Reactions are separate from authoritative board state and never sent optimistically. */
export function usePlayerReactions({ roomId, playerColor, socket, enabled }: Options) {
  const scope = `${roomId}:${playerColor}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const live = useRef({ scope, enabled, mounted: true });
  const cooldown = useRef(0);
  const seen = useRef(new Set<string>());
  const timers = useRef<Partial<Record<Color, ReturnType<typeof setTimeout>>>>({});

  const cancelTimers = useCallback(() => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
  }, []);

  const resetReactions = useCallback(() => {
    cancelTimers();
    cooldown.current = 0;
    seen.current.clear();
    if (live.current.mounted) setSnapshot(null);
  }, [cancelTimers]);

  useLayoutEffect(() => {
    live.current = { scope, enabled, mounted: true };
    resetReactions();
    const seenEvents = seen.current;
    return () => {
      live.current.mounted = false;
      cancelTimers();
      cooldown.current = 0;
      seenEvents.clear();
    };
  }, [scope, enabled, cancelTimers, resetReactions]);

  const isCurrent = useCallback(() => (
    live.current.mounted && live.current.enabled && live.current.scope === scope
  ), [scope]);

  const update = useCallback((change: (current: Snapshot) => Snapshot) => {
    if (!isCurrent()) return;
    setSnapshot(current => change(current?.scope === scope ? current : {
      scope, reactions: {}, cooldownUntil: 0, error: null,
    }));
  }, [isCurrent, scope]);

  const receiveReaction = useCallback((message: unknown) => {
    if (!isCurrent()) return;
    const payload = payloadOf(message, "player_reaction");
    if (!payload || payload.roomId !== roomId ||
      typeof payload.id !== "string" || !payload.id || payload.id.length > 128 ||
      !isPlayerReactionId(payload.reactionId) ||
      (payload.color !== "white" && payload.color !== "black") ||
      typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= 0 ||
      typeof payload.remainingMs !== "number" || !Number.isFinite(payload.remainingMs) ||
      payload.remainingMs <= 0 || payload.remainingMs > REACTION_DISPLAY_MS ||
      typeof payload.cooldownMs !== "number" || !Number.isFinite(payload.cooldownMs) ||
      payload.cooldownMs < 0 || payload.cooldownMs > REACTION_COOLDOWN_MS ||
      seen.current.has(payload.id)) return;

    seen.current.add(payload.id);
    if (seen.current.size > 128) {
      const oldest = seen.current.values().next().value;
      if (oldest !== undefined) seen.current.delete(oldest);
    }
    const color = payload.color;
    const reaction: PlayerReaction = {
      id: payload.id,
      roomId,
      color,
      reactionId: payload.reactionId,
      expiresAt: Date.now() + payload.remainingMs,
    };
    if (color === playerColor) {
      cooldown.current = Math.max(cooldown.current, Date.now() + payload.cooldownMs);
    }
    update(current => ({
      ...current,
      reactions: { ...current.reactions, [color]: reaction },
      cooldownUntil: cooldown.current,
      error: null,
    }));
    clearTimeout(timers.current[color]);
    timers.current[color] = setTimeout(() => {
      if (!isCurrent()) return;
      update(current => {
        if (current.reactions[color]?.id !== reaction.id) return current;
        const reactions = { ...current.reactions };
        delete reactions[color];
        return { ...current, reactions };
      });
      delete timers.current[color];
    }, payload.remainingMs);
  }, [isCurrent, roomId, playerColor, update]);

  const receiveReactionError = useCallback((message: unknown) => {
    if (!isCurrent()) return;
    const payload = payloadOf(message, "player_reaction_error");
    if (!payload || payload.roomId !== roomId ||
      (payload.reason !== "cooldown" && payload.reason !== "unavailable" && payload.reason !== "invalid")) return;
    const reason = payload.reason;
    if (reason === "cooldown") {
      const retry = typeof payload.retryAfterMs === "number" && Number.isFinite(payload.retryAfterMs)
        ? Math.min(REACTION_COOLDOWN_MS, Math.max(0, payload.retryAfterMs))
        : REACTION_COOLDOWN_MS;
      cooldown.current = Math.max(cooldown.current, Date.now() + retry);
    } else {
      cooldown.current = 0;
    }
    update(current => ({ ...current, cooldownUntil: cooldown.current, error: reason }));
  }, [isCurrent, roomId, update]);

  const sendReaction = useCallback((reactionId: PlayerReactionId): boolean => {
    if (!isCurrent() || !isPlayerReactionId(reactionId)) return false;
    if (cooldown.current > Date.now()) return false;
    if (!socket.isConnected()) {
      update(current => ({ ...current, error: "unavailable" }));
      return false;
    }
    // Lock synchronously: two clicks in the same React batch cannot both send.
    cooldown.current = Date.now() + REACTION_COOLDOWN_MS;
    let sent = false;
    try {
      sent = socket.send("player_reaction", { reactionId });
    } catch {
      // A socket can close between the readiness check and send().
    }
    if (!sent) cooldown.current = 0;
    update(current => ({
      ...current, cooldownUntil: cooldown.current, error: sent ? null : "unavailable",
    }));
    return sent;
  }, [isCurrent, socket, update]);

  useEffect(() => {
    if (!snapshot?.error || snapshot.cooldownUntil <= Date.now()) return;
    const timer = setTimeout(() => {
      update(current => ({ ...current, error: null }));
    }, snapshot.cooldownUntil - Date.now());
    return () => clearTimeout(timer);
  }, [snapshot?.error, snapshot?.cooldownUntil, update]);

  const current = enabled && snapshot?.scope === scope ? snapshot : null;
  return {
    reactions: current?.reactions ?? {},
    sendReaction,
    reactionCooldownUntil: current?.cooldownUntil ?? 0,
    reactionError: current?.error ?? null,
    receiveReaction,
    receiveReactionError,
    resetReactions,
  };
}
