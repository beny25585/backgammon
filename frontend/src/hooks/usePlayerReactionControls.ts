import { useState } from "react";
import { useGame } from "../services/gameContext";
import type { Color } from "../lib/backgammon/engine";

/** Share local muting between the picker in the rail and reactions on the board. */
export function usePlayerReactionControls(playerColor: Color) {
  const { roomId, supportsPlayerReactions = false, playerReactionsEnabled = false,
    playerReactions, sendReaction, reactionCooldownUntil = 0, reactionError = null,
    whiteName, blackName } = useGame();
  const scope = `${roomId}:${playerColor}`;
  const [muteState, setMuteState] = useState<{ scope: string; muted: boolean; ignoredId?: string }>({ scope, muted: false });
  const muted = muteState.scope === scope && muteState.muted;
  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentReaction = playerReactions?.[opponentColor];
  const visibleOpponentReaction = muted || (muteState.scope === scope && muteState.ignoredId === opponentReaction?.id)
    ? undefined : opponentReaction;

  return {
    scope,
    names: { white: whiteName, black: blackName },
    reactions: supportsPlayerReactions ? {
      [playerColor]: playerReactions?.[playerColor],
      [opponentColor]: visibleOpponentReaction,
    } : {},
    pickerProps: supportsPlayerReactions && sendReaction ? {
      enabled: playerReactionsEnabled,
      cooldownUntil: reactionCooldownUntil,
      error: reactionError,
      muted,
      onToggleMuted: () => setMuteState({ scope, muted: !muted, ignoredId: opponentReaction?.id }),
      onSend: sendReaction,
    } : null,
  };
}
