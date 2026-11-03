import { useMemo, useRef, useState } from "react";
import { usePlayerReactions } from "./usePlayerReactions";
import type { Color } from "../types/game";

export function PlayerReactionsHarness({
  roomId = "room-a", playerColor = "white", enabled = true,
  connected = true, sendSucceeds = true, message, errorMessage,
}: {
  roomId?: string;
  playerColor?: Color;
  enabled?: boolean;
  connected?: boolean;
  sendSucceeds?: boolean;
  message?: unknown;
  errorMessage?: unknown;
}) {
  const [sent, setSent] = useState(0);
  const socket = useMemo(() => ({
    isConnected: () => connected,
    send: () => {
      setSent(count => count + 1);
      return sendSucceeds;
    },
  }), [connected, sendSucceeds]);
  const reactions = usePlayerReactions({ roomId, playerColor, enabled, socket });
  const previousReceiver = useRef<((message: unknown) => void) | null>(null);
  return (
    <div>
      <output data-testid="reactions">{JSON.stringify(reactions.reactions)}</output>
      <output data-testid="sent">{sent}</output>
      <output data-testid="cooldown">{reactions.reactionCooldownUntil}</output>
      <output data-testid="error">{reactions.reactionError ?? "none"}</output>
      <button onClick={() => reactions.sendReaction("thanks")}>send</button>
      <button onClick={() => {
        reactions.sendReaction("thanks");
        reactions.sendReaction("smile");
      }}>send twice</button>
      <button onClick={() => reactions.receiveReaction(message)}>receive</button>
      <button onClick={() => reactions.receiveReactionError(errorMessage)}>receive error</button>
      <button onClick={() => { previousReceiver.current = reactions.receiveReaction; }}>save receiver</button>
      <button onClick={() => previousReceiver.current?.(message)}>old receiver</button>
      <button onClick={reactions.resetReactions}>reset</button>
    </div>
  );
}
