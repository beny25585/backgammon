import { useState } from "react";
import PlayerReactionPicker from "./PlayerReactionPicker";
import BoardPlayerReactions from "./BoardPlayerReactions";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { PlayerReaction, PlayerReactionId, ReactionError } from "../../lib/playerReactions";

const boardReactions: Partial<Record<"white" | "black", PlayerReaction>> = {
  white: { id: "board-white", roomId: "board-room", color: "white", reactionId: "dice", expiresAt: Number.MAX_SAFE_INTEGER },
  black: { id: "board-black", roomId: "board-room", color: "black", reactionId: "nice_move", expiresAt: Number.MAX_SAFE_INTEGER },
};

/** Representative playing halves; the occupied rectangles use the board's real markers. */
export function BoardReactionsHarness({ crowded = false, rotated = false }: { crowded?: boolean; rotated?: boolean }) {
  return (
    <I18nProvider>
      <div className="relative h-[640px] w-[660px]">
        <div data-testid="board-wrapper" className={`relative h-80 w-[600px] ${rotated ? "origin-top-left translate-x-80 rotate-90 [--game-rotated:1]" : ""}`}>
          {(["left", "right"] as const).map(side => (
            <div key={side} data-testid={`board-half-${side}`} className={`absolute inset-y-0 w-[280px] ${side === "left" ? "left-0" : "left-80"}`}>
              <div data-checker className="absolute top-8 left-9 size-14" />
              <div data-testid="dice-overlay" className="absolute top-[142px] left-24 h-9 w-[88px]" />
              <button type="button" aria-label={`${side} action`} className="absolute top-[198px] left-24 h-11 w-[88px]">Action</button>
              {crowded && <div data-checker data-testid={`crowded-${side}`} className="absolute inset-0" />}
            </div>
          ))}
          <BoardPlayerReactions reactions={boardReactions} names={{ white: "Alice", black: "Bob" }} playerColor="white" />
        </div>
      </div>
    </I18nProvider>
  );
}

export function PlayerReactionPickerHarness({ enabled = true, serverError = null, sendSucceeds = true }: {
  enabled?: boolean;
  serverError?: ReactionError | null;
  sendSucceeds?: boolean;
}) {
  const [muted, setMuted] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [selected, setSelected] = useState<PlayerReactionId | null>(null);
  const [sendError, setSendError] = useState<ReactionError | null>(null);
  return (
    <I18nProvider>
      <PlayerReactionPicker
        enabled={enabled}
        cooldownUntil={cooldownUntil}
        error={serverError ?? sendError}
        muted={muted}
        onToggleMuted={() => setMuted(value => !value)}
        onSend={id => {
          if (!sendSucceeds) {
            setSendError("unavailable");
            return false;
          }
          setSendError(null);
          setSelected(id);
          setCooldownUntil(Date.now() + 3000);
          return true;
        }}
      />
      <output data-testid="sent-reaction">{selected ?? "none"}</output>
    </I18nProvider>
  );
}
