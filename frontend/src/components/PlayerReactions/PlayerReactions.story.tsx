import { useState } from "react";
import PlayerReactionPicker from "./PlayerReactionPicker";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { PlayerReactionId, ReactionError } from "../../lib/playerReactions";

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
