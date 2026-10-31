import { test, expect } from "@playwright/experimental-ct-react";
import { StrictMode } from "react";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { makeGameState } from "../../test-utils/gameState";
import { canOfferDouble, isBarEntryFullyBlocked, type Color, type GameState } from "../../lib/backgammon/engine";
import type { GameContextType } from "../../types/context";

function blockedBar(color: Color): GameState {
  const points = Array<number>(24).fill(0);
  const ownSign = color === "white" ? 1 : -1;
  for (let die = 1; die <= 6; die++) {
    points[color === "white" ? 24 - die : die - 1] = -2 * ownSign;
  }
  points[color === "white" ? 5 : 18] = 14 * ownSign;
  points[color === "white" ? 11 : 12] = -3 * ownSign;
  return makeGameState({
    points, bar: { white: 0, black: 0, [color]: 1 },
    phase: "rolling", turn: color, dice: [], remaining: [],
    gameFormat: "match", cube: 1, cubeOwner: "center", version: 1,
  });
}

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "false"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
});

for (const color of ["white", "black"] as const) {
  test(`${color}: a fully closed bar requests one blocked pass with auto roll off, including StrictMode`, async ({ mount, page }) => {
    const state = blockedBar(color);
    const match = { targetPoints: 3, matchScore: { white: 0, black: 0 } };
    expect(isBarEntryFullyBlocked(state, color)).toBe(true);
    expect(canOfferDouble(state, color, match)).toBe(true);
    let rolls = 0;
    const screen = (
      <StrictMode>
        <MockGameWrapper playerColor={color} state={state} context={{
          roomId: "blocked-bar", ...match, rollDice: () => rolls++,
        }}>
          <GameScreen />
        </MockGameWrapper>
      </StrictMode>
    );
    const component = await mount(screen);
    await expect.poll(() => rolls).toBe(1);
    await page.clock.runFor(1000);
    expect(rolls).toBe(1);
    await component.update(screen);
    await page.clock.runFor(1000);
    expect(rolls).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("bg_auto_roll"))).toBe("false");
  });

  for (const scenario of ["five closed points", "one entry is a blot", "no checker on the bar"] as const) {
    test(`${color}: ${scenario} keeps rolling manual when auto roll is off`, async ({ mount, page }) => {
      const state = blockedBar(color);
      const entry = color === "white" ? 23 : 0;
      const spare = color === "white" ? 11 : 12;
      if (scenario === "five closed points") {
        state.points[spare] += state.points[entry];
        state.points[entry] = 0;
      }
      if (scenario === "one entry is a blot") {
        state.points[entry] /= 2;
        state.points[spare] += state.points[entry];
      }
      if (scenario === "no checker on the bar") {
        state.bar[color] = 0;
        state.points[color === "white" ? 5 : 18] += color === "white" ? 1 : -1;
      }
      expect(isBarEntryFullyBlocked(state, color)).toBe(false);
      let rolls = 0;
      const component = await mount(
        <MockGameWrapper playerColor={color} state={state} context={{ rollDice: () => rolls++ }}>
          <GameScreen />
        </MockGameWrapper>,
      );
      const rollButton = component.getByTitle("Tap to roll");
      await expect(rollButton).toBeVisible();
      await page.clock.runFor(1000);
      expect(rolls).toBe(0);
      await rollButton.click();
      await expect.poll(() => rolls).toBe(1);
    });
  }

  test(`${color}: fully blocked bar waits for an error to clear before requesting its pass once`, async ({ mount, page }) => {
    const state = blockedBar(color);
    let rolls = 0;
    const screen = (error: string | null) => (
      <MockGameWrapper playerColor={color} state={state} context={{ error, rollDice: () => rolls++ }}>
        <GameScreen />
      </MockGameWrapper>
    );
    const component = await mount(screen("Dice service unavailable"));
    await page.clock.runFor(1000);
    expect(rolls).toBe(0);
    await component.update(screen(null));
    await expect.poll(() => rolls).toBe(1);
    await component.update(screen(null));
    await page.clock.runFor(1000);
    expect(rolls).toBe(1);
  });

  const pauses: { name: string; context: Partial<GameContextType> }[] = [
    { name: "loading", context: { isLoading: true } },
    { name: "opponent disconnected", context: { opponentConnected: false } },
  ];
  for (const pause of pauses) {
    test(`${color}: fully blocked bar waits to request its pass while ${pause.name}`, async ({ mount, page }) => {
      const state = blockedBar(color);
      let rolls = 0;
      const screen = (paused: boolean) => (
        <MockGameWrapper playerColor={color} state={state} context={{
          ...(paused ? pause.context : {}), rollDice: () => rolls++,
        }}>
          <GameScreen />
        </MockGameWrapper>
      );
      const component = await mount(screen(true));
      await page.clock.runFor(1000);
      expect(rolls).toBe(0);
      await component.update(screen(false));
      await expect.poll(() => rolls).toBe(1);
      await page.clock.runFor(1000);
      expect(rolls).toBe(1);
    });
  }
}
