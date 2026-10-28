import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "../lib/backgammon/engine";
import { createGameAudio, type GameAudio } from "../lib/audio/gameAudio";
import { getGameSound, isGameSoundBoundary, type GameSoundSnapshot } from "../lib/audio/gameSoundEvents";

const STORAGE_KEY = "6b-game-sounds";
type GameSoundOptions = Omit<GameSoundSnapshot, "state" | "roomId">;

export function useGameSounds(state: GameState | null, roomId: string | undefined, {
  playerColor, matchScore, isLoading, reconnected, connectionEpoch = 0,
}: GameSoundOptions) {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "false"; }
    catch { return true; }
  });
  const audioRef = useRef<GameAudio | null>(null);
  const previousRef = useRef<GameSoundSnapshot>({ state, roomId, playerColor, matchScore, isLoading, reconnected, connectionEpoch });
  const victoryConsumedRef = useRef(state?.phase === "game_over");
  const playActionSound = useCallback((sound: "undo" | "confirm") => {
    if (soundEnabled) audioRef.current?.play(sound);
  }, [soundEnabled]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(soundEnabled)); }
    catch { /* Storage can be unavailable in private browser modes. */ }
    if (!soundEnabled) return;

    const unlockAudio = () => {
      if (!audioRef.current) {
        const Audio = window.AudioContext ?? (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
        if (!Audio) return;
        audioRef.current = createGameAudio(new Audio());
        audioRef.current.preload();
      }
      audioRef.current.resume();
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      audioRef.current?.close();
      audioRef.current = null;
    };
  }, [soundEnabled]);

  useEffect(() => {
    const previous = previousRef.current;
    const next = { state, roomId, playerColor, matchScore, isLoading, reconnected, connectionEpoch };
    previousRef.current = next;
    if (isGameSoundBoundary(previous, next)) {
      audioRef.current?.stop();
      victoryConsumedRef.current = state?.phase === "game_over";
    } else if (state?.phase !== "game_over") {
      victoryConsumedRef.current = false;
    }
    const sound = getGameSound(previous, next);
    if (sound === "win") {
      if (victoryConsumedRef.current) return;
      // Consume muted wins too: enabling sound or a score correction cannot replay them.
      victoryConsumedRef.current = true;
    }
    if (soundEnabled && sound) audioRef.current?.play(sound);
  }, [state, roomId, playerColor, matchScore, isLoading, reconnected, connectionEpoch, soundEnabled]);

  return { soundEnabled, setSoundEnabled, playActionSound };
}
