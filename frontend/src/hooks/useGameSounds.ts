import { useEffect, useRef, useState } from "react";
import type { GameState } from "../lib/backgammon/engine";

const STORAGE_KEY = "6b-game-sounds";
type GameSound = "roll" | "move" | "hit";

function playSound(context: AudioContext, sound: GameSound) {
  if (context.state !== "running") return;
  const start = context.currentTime;
  const taps = sound === "roll" ? 5 : sound === "hit" ? 2 : 1;
  for (let index = 0; index < taps; index++) {
    const at = start + index * (sound === "roll" ? 0.04 : 0.075);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(sound === "hit" ? 260 : 520 + index * 80, at);
    oscillator.frequency.exponentialRampToValueAtTime(100, at + 0.055);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + 0.08);
  }
}

export function useGameSounds(state: GameState | null, roomId?: string) {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "false"; }
    catch { return true; }
  });
  const audioRef = useRef<AudioContext | null>(null);
  const previousRef = useRef<{ state: GameState | null; roomId?: string }>({ state, roomId });

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
        audioRef.current = new Audio();
      }
      if (audioRef.current.state === "suspended") void audioRef.current.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio && audio.state !== "closed") void audio.close().catch(() => {});
    };
  }, [soundEnabled]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { state, roomId };
    const before = previous.state;
    const audio = audioRef.current;
    if (!state || !before || previous.roomId !== roomId || !soundEnabled || !audio) return;

    const openingRolled = (Object.keys(state.openingRoll) as ("white" | "black")[]).some(
      (color) => before.openingRoll[color] === null && state.openingRoll[color] !== null,
    );
    const rolled = before.phase === "rolling" && state.phase === "moving" && state.dice.length > 0;
    if (openingRolled || rolled) {
      playSound(audio, "roll");
    } else if ((state.lastMove?.length ?? 0) > (before.lastMove?.length ?? 0) &&
      (state.home.white !== before.home.white || state.home.black !== before.home.black ||
        state.points.some((point, index) => point !== before.points[index]))) {
      const hit = state.bar.white > before.bar.white || state.bar.black > before.bar.black;
      playSound(audio, hit ? "hit" : "move");
    }
  }, [state, roomId, soundEnabled]);

  return { soundEnabled, setSoundEnabled };
}
