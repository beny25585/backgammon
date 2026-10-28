import { useGameSounds } from "./useGameSounds";
import type { GameSoundSnapshot } from "../lib/audio/gameSoundEvents";

export function GameSoundsHarness({ snapshot }: { snapshot: GameSoundSnapshot }) {
  const { soundEnabled, setSoundEnabled, playActionSound } = useGameSounds(
    snapshot.state,
    snapshot.roomId,
    {
      playerColor: snapshot.playerColor,
      matchScore: snapshot.matchScore,
      isLoading: snapshot.isLoading,
      reconnected: snapshot.reconnected,
      connectionEpoch: snapshot.connectionEpoch,
    },
  );

  return (
    <div>
      <output data-testid="sound-enabled">{soundEnabled ? "enabled" : "muted"}</output>
      <button data-testid="unlock" type="button">Unlock audio</button>
      <button data-testid="toggle" type="button" onClick={() => setSoundEnabled(!soundEnabled)}>
        Toggle audio
      </button>
      <button data-testid="confirm" type="button" onClick={() => playActionSound("confirm")}>
        Confirm
      </button>
    </div>
  );
}
