import diceRollUrl from "../../assets/sounds/dice-roll.wav?url";
import checkerHitUrl from "../../assets/sounds/checker-hit.wav?url";
import checkerBearOffUrl from "../../assets/sounds/checker-bear-off.wav?url";
import doubleOfferUrl from "../../assets/sounds/double-offer.wav?url";
import victoryUrl from "../../assets/sounds/victory.wav?url";
import type { GameSound } from "./gameSoundEvents";

const SAMPLES = {
  roll: { url: diceRollUrl, volume: 0.55 },
  hit: { url: checkerHitUrl, volume: 0.5 },
  bearOff: { url: checkerBearOffUrl, volume: 0.32 },
  double: { url: doubleOfferUrl, volume: 0.45 },
  win: { url: victoryUrl, volume: 0.4 },
} as const;

type SampleSound = keyof typeof SAMPLES;
const MAX_LOAD_DELAY_MS = 300;

export interface GameAudio {
  preload: () => void;
  resume: () => void;
  play: (sound: GameSound) => void;
  stop: () => void;
  close: () => void;
}

/** One player per mounted game; sample loading never blocks gameplay. */
export function createGameAudio(context: AudioContext): GameAudio {
  const controller = new AbortController();
  const buffers = new Map<SampleSound, Promise<AudioBuffer | null>>();
  const sources = new Set<AudioScheduledSourceNode>();
  let disposed = false;
  let generation = 0;

  function load(sound: SampleSound): Promise<AudioBuffer | null> {
    const cached = buffers.get(sound);
    if (cached) return cached;
    const pending = fetch(SAMPLES[sound].url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Sound sample unavailable");
        return response.arrayBuffer();
      })
      .then((data) => disposed ? null : context.decodeAudioData(data))
      .catch(() => null);
    buffers.set(sound, pending);
    return pending;
  }

  function track(source: AudioScheduledSourceNode, gain: GainNode) {
    source.connect(gain);
    gain.connect(context.destination);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
  }

  // Keep the existing short action tones; also provide a quiet offline fallback.
  function playTone(sound: GameSound) {
    const notes = sound === "win" ? [523.25, 659.25, 783.99, 1046.5] :
      sound === "double" ? [660, 880] : sound === "roll" ? [520, 600, 680, 760, 840] :
        sound === "hit" ? [260, 340] : sound === "confirm" ? [600, 800] :
          sound === "undo" ? [400] : sound === "bearOff" ? [720] : [520];
    const spacing = sound === "roll" ? 0.04 : sound === "win" ? 0.085 : 0.075;
    notes.forEach((frequency, index) => {
      const at = context.currentTime + index * spacing;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.exponentialRampToValueAtTime(
        sound === "confirm" || sound === "win" || sound === "double" ? frequency * 1.2 : 100,
        at + 0.055,
      );
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(sound === "bearOff" ? 0.07 : 0.12, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
      track(oscillator, gain);
      oscillator.start(at);
      oscillator.stop(at + 0.08);
    });
  }

  function stop() {
    generation += 1;
    for (const source of sources) source.stop();
    sources.clear();
  }

  return {
    preload() {
      if (disposed) return;
      for (const sound of Object.keys(SAMPLES) as SampleSound[]) void load(sound);
    },
    resume() {
      if (!disposed && context.state === "suspended") void context.resume().catch(() => {});
    },
    play(sound) {
      if (disposed || context.state !== "running") return;
      if (!(sound in SAMPLES)) {
        playTone(sound);
        return;
      }
      const sampleSound = sound as SampleSound;
      const requestedAt = performance.now();
      const requestedGeneration = generation;
      void load(sampleSound).then((buffer) => {
        if (disposed || generation !== requestedGeneration || context.state !== "running" ||
          performance.now() - requestedAt > MAX_LOAD_DELAY_MS) return;
        if (!buffer) {
          playTone(sound);
          return;
        }
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = SAMPLES[sampleSound].volume;
        track(source, gain);
        source.start();
      });
    },
    stop,
    close() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      stop();
      if (context.state !== "closed") void context.close().catch(() => {});
    },
  };
}
