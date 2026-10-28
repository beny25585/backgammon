import { test, expect } from "@playwright/experimental-ct-react";
import { newGame, type GameState } from "../lib/backgammon/engine";
import type { GameSoundSnapshot } from "../lib/audio/gameSoundEvents";
import { GameSoundsHarness } from "./useGameSounds.story";

interface AudioProbe {
  now: number;
  created: number;
  closed: number;
  started: number;
  stopped: number;
  fetched: number;
  pendingDecodes: number;
  deferDecodes: boolean;
  releaseDecodes: () => void;
}

declare global {
  interface Window {
    __gameSoundProbe: AudioProbe;
  }
}

function snapshot(overrides: Partial<GameSoundSnapshot> = {}): GameSoundSnapshot {
  return {
    state: {
      ...newGame(), phase: "rolling", openingRoll: { white: 6, black: 1 },
    },
    roomId: "room-a",
    playerColor: "white",
    matchScore: { white: 0, black: 0 },
    isLoading: false,
    reconnected: false,
    ...overrides,
  };
}

function rollAfter(before: GameSoundSnapshot): GameSoundSnapshot {
  return {
    ...before,
    state: { ...before.state as GameState, phase: "moving", dice: [6, 1], remaining: [6, 1] },
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const decodes: (() => void)[] = [];
    const probe: AudioProbe = {
      now: 1000,
      created: 0, closed: 0, started: 0, stopped: 0, fetched: 0,
      pendingDecodes: 0, deferDecodes: false,
      releaseDecodes() {
        probe.deferDecodes = false;
        for (const resolve of decodes.splice(0)) resolve();
      },
    };
    window.__gameSoundProbe = probe;
    Object.defineProperty(performance, "now", { configurable: true, value: () => probe.now });

    class FakeParam {
      value = 0;
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }

    class FakeSource {
      buffer: AudioBuffer | null = null;
      frequency = new FakeParam();
      type = "triangle";
      onended: (() => void) | null = null;
      ended = false;
      connect() {}
      disconnect() {}
      start() { probe.started += 1; }
      stop(at?: number) {
        // A scheduled natural end remains active until lifecycle cleanup stops it.
        if (at !== undefined || this.ended) return;
        this.ended = true;
        probe.stopped += 1;
        this.onended?.();
      }
    }

    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      constructor() { probe.created += 1; }
      resume() { this.state = "running"; return Promise.resolve(); }
      close() { this.state = "closed"; probe.closed += 1; return Promise.resolve(); }
      createGain() {
        return { gain: new FakeParam(), connect() {}, disconnect() {} };
      }
      createOscillator() { return new FakeSource(); }
      createBufferSource() { return new FakeSource(); }
      decodeAudioData() {
        if (!probe.deferDecodes) return Promise.resolve({} as AudioBuffer);
        probe.pendingDecodes += 1;
        return new Promise<AudioBuffer>((resolve) => {
          decodes.push(() => {
            probe.pendingDecodes -= 1;
            resolve({} as AudioBuffer);
          });
        });
      }
    }

    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\.wav(?:\?|$)/.test(url)) {
        probe.fetched += 1;
        return Promise.resolve(new Response(new ArrayBuffer(1), { status: 200 }));
      }
      return originalFetch(input, init);
    };
  });
});

test("audio waits for a gesture, preloads once and closes on unmount", async ({ mount, page }) => {
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await expect(component.getByTestId("sound-enabled")).toHaveText("enabled");
  expect(await page.evaluate(() => window.__gameSoundProbe.created)).toBe(0);
  await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);

  await component.getByTestId("unlock").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.fetched)).toBe(5);
  expect(await page.evaluate(() => window.__gameSoundProbe.created)).toBe(1);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);
  await component.update(<GameSoundsHarness snapshot={before} />);
  await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBeGreaterThan(0);
  await component.getByTestId("confirm").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__gameSoundProbe.fetched)).toBe(5);

  await component.unmount();
  expect(await page.evaluate(() => window.__gameSoundProbe.closed)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
  expect(await page.evaluate(() => window.__gameSoundProbe.created)).toBe(1);
});

test("a saved mute preference stays silent and enabling never replays a missed roll", async ({ mount, page }) => {
  await page.addInitScript(() => localStorage.setItem("6b-game-sounds", "false"));
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await expect(component.getByTestId("sound-enabled")).toHaveText("muted");
  await component.getByTestId("unlock").click();
  await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);
  expect(await page.evaluate(() => window.__gameSoundProbe.created)).toBe(0);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);

  await component.getByTestId("toggle").click();
  await expect(component.getByTestId("sound-enabled")).toHaveText("enabled");
  expect(await page.evaluate(() => localStorage.getItem("6b-game-sounds"))).toBe("true");
  await component.getByTestId("unlock").click();
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);
  await component.getByTestId("confirm").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBeGreaterThan(0);
});

for (const dispose of ["mute", "unmount"] as const) {
  test(`${dispose} cancels a sample that is still decoding`, async ({ mount, page }) => {
    const before = snapshot();
    const component = await mount(<GameSoundsHarness snapshot={before} />);
    await page.evaluate(() => { window.__gameSoundProbe.deferDecodes = true; });
    await component.getByTestId("unlock").click();
    await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(5);
    await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);

    if (dispose === "mute") {
      await component.getByTestId("toggle").click();
      await expect(component.getByTestId("sound-enabled")).toHaveText("muted");
      expect(await page.evaluate(() => localStorage.getItem("6b-game-sounds"))).toBe("false");
    } else {
      await component.unmount();
    }
    expect(await page.evaluate(() => window.__gameSoundProbe.closed)).toBe(1);
    await page.evaluate(() => window.__gameSoundProbe.releaseDecodes());
    await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(0);
    expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);
  });
}

for (const reset of ["room", "player", "loading", "reconnection", "connection epoch", "missing state"] as const) {
  test(`${reset} cancels a pending sound from the previous live state`, async ({ mount, page }) => {
    const before = snapshot(reset === "connection epoch" ? { reconnected: true, connectionEpoch: 1 } : {});
    const after = rollAfter(before);
    const component = await mount(<GameSoundsHarness snapshot={before} />);
    await page.evaluate(() => { window.__gameSoundProbe.deferDecodes = true; });
    await component.getByTestId("unlock").click();
    await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(5);
    await component.update(<GameSoundsHarness snapshot={after} />);
    const resetSnapshot: GameSoundSnapshot = {
      ...after,
      ...(reset === "room" ? { roomId: "room-b" } : {}),
      ...(reset === "player" ? { playerColor: "black" as const } : {}),
      ...(reset === "loading" ? { isLoading: true } : {}),
      ...(reset === "reconnection" ? { reconnected: true } : {}),
      ...(reset === "connection epoch" ? { connectionEpoch: 2 } : {}),
      ...(reset === "missing state" ? { state: null } : {}),
    };
    await component.update(<GameSoundsHarness snapshot={resetSnapshot} />);
    await page.evaluate(() => window.__gameSoundProbe.releaseDecodes());
    await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(0);
    expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);
  });
}

test("room changes stop already playing cues without creating another audio context", async ({ mount, page }) => {
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await component.getByTestId("confirm").click();
  const started = await page.evaluate(() => window.__gameSoundProbe.started);
  expect(started).toBeGreaterThan(0);
  await component.update(<GameSoundsHarness snapshot={{ ...before, roomId: "room-b" }} />);
  expect(await page.evaluate(() => window.__gameSoundProbe.stopped)).toBe(started);
  expect(await page.evaluate(() => window.__gameSoundProbe.created)).toBe(1);
});

test("an undecoded cue is dropped after its useful playback window", async ({ mount, page }) => {
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await page.evaluate(() => { window.__gameSoundProbe.deferDecodes = true; });
  await component.getByTestId("unlock").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(5);
  await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);
  await page.evaluate(() => {
    window.__gameSoundProbe.now += 301;
    window.__gameSoundProbe.releaseDecodes();
  });
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.pendingDecodes)).toBe(0);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);

  // Assets are now ready, so a fresh live roll still plays immediately.
  await component.update(<GameSoundsHarness snapshot={before} />);
  await component.update(<GameSoundsHarness snapshot={rollAfter(before)} />);
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBe(1);
});

test("one confirmed victory plays once despite score corrections, then a new game can celebrate", async ({ mount, page }) => {
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await component.getByTestId("unlock").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.fetched)).toBe(5);
  const terminal: GameSoundSnapshot = {
    ...before,
    state: { ...before.state as GameState, phase: "game_over", winner: "white" },
    matchScore: { white: 1, black: 0 },
  };
  await component.update(<GameSoundsHarness snapshot={terminal} />);
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBe(1);
  const corrected = { ...terminal, matchScore: { white: 2, black: 0 } };
  await component.update(<GameSoundsHarness snapshot={corrected} />);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(1);
  await component.update(<GameSoundsHarness snapshot={{ ...before, matchScore: corrected.matchScore }} />);
  await component.update(<GameSoundsHarness snapshot={{ ...terminal, matchScore: { white: 3, black: 0 } }} />);
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBe(2);
});

test("a muted victory is consumed and cannot replay after enabling or a score correction", async ({ mount, page }) => {
  await page.addInitScript(() => localStorage.setItem("6b-game-sounds", "false"));
  const before = snapshot();
  const component = await mount(<GameSoundsHarness snapshot={before} />);
  await expect(component.getByTestId("sound-enabled")).toHaveText("muted");
  const terminal: GameSoundSnapshot = {
    ...before,
    state: { ...before.state as GameState, phase: "game_over", winner: "white" },
    matchScore: { white: 1, black: 0 },
  };
  await component.update(<GameSoundsHarness snapshot={terminal} />);
  await component.getByTestId("toggle").click();
  await expect(component.getByTestId("sound-enabled")).toHaveText("enabled");
  await component.getByTestId("unlock").click();
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.fetched)).toBe(5);
  await component.update(<GameSoundsHarness snapshot={{ ...terminal, matchScore: { white: 2, black: 0 } }} />);
  expect(await page.evaluate(() => window.__gameSoundProbe.started)).toBe(0);

  await component.update(<GameSoundsHarness snapshot={{ ...before, matchScore: { white: 2, black: 0 } }} />);
  await component.update(<GameSoundsHarness snapshot={{ ...terminal, matchScore: { white: 3, black: 0 } }} />);
  await expect.poll(() => page.evaluate(() => window.__gameSoundProbe.started)).toBe(1);
});
