import { test, expect } from "@playwright/experimental-ct-react";
import { StrictMode } from "react";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { makeGameState } from "../../test-utils/gameState";
import { ErrorCardHarness } from "../../test-utils/probes";
import { DEFAULT_BOARD_THEME } from "../BoardThemeSelector/boardThemes";

test("brown and gold is the default board theme", () => {
  expect(DEFAULT_BOARD_THEME).toBe("brownGold");
});

test("changing the board theme recolors the player rail and preserves the clock", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("6b-board-theme", "brownGold"));
  const component = await mount(
    <MockGameWrapper playerColor="white" state={makeGameState({ phase: "rolling", turn: "white" })}>
      <GameScreen />
    </MockGameWrapper>,
  );
  const rail = component.getByTestId("side-panel");
  const score = rail.getByTestId("player-score-white");
  const clock = rail.getByTestId("clock-my");
  const toggle = component.getByTestId("game-settings-toggle");
  await expect(score).toHaveCSS("background-color", "rgb(43, 33, 24)");
  const initialRail = await rail.evaluate(element => getComputedStyle(element).backgroundImage);
  const clockBackground = await clock.evaluate(element => getComputedStyle(element).backgroundColor);

  await toggle.press("Enter");
  await component.getByRole("combobox", { name: "Board style" }).selectOption("charcoalGold");

  await expect(component.getByTestId("board-frame")).toHaveAttribute("data-board-theme", "charcoalGold");
  await expect(rail).not.toHaveCSS("background-image", initialRail);
  await expect(score).toHaveCSS("background-color", "rgb(23, 27, 28)");
  await expect(toggle).toHaveCSS("background-color", "rgb(23, 27, 28)");
  await expect(clock).toHaveCSS("background-color", clockBackground);
});

for (const [theme, label, fieldColor] of [
  ["classicBrown", "Classic brown", "rgb(118, 81, 58)"],
  ["classicLight", "Classic light", "rgb(237, 232, 215)"],
] as const) {
  test(`${theme} applies its palette and survives reopening the game`, async ({ mount, page }) => {
    await page.evaluate(() => localStorage.removeItem("6b-board-theme"));
    const screen = (
      <MockGameWrapper playerColor="white" state={makeGameState({ phase: "rolling", turn: "white" })}>
        <GameScreen />
      </MockGameWrapper>
    );
    const component = await mount(screen);
    await expect(component.getByTestId("game-settings-toggle")).toHaveAttribute("aria-expanded", "false");
    await component.getByTestId("game-settings-toggle").press("Enter");
    const selector = component.getByRole("combobox", { name: "Board style" });
    await selector.selectOption({ label });
    await expect(selector).toHaveValue(theme);
    await expect(component.getByTestId("board-inner")).toHaveCSS("background-color", fieldColor);
    await expect(component.getByTestId("doubling-cube")).toHaveCSS("color", "rgb(255, 244, 207)");
    const drawerWidth = await component.getByTestId("game-settings-panel").evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    expect(drawerWidth).toBeLessThanOrEqual(280);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("6b-board-theme"))).toBe(theme);
    await component.unmount();
    const reopened = await mount(screen);
    await expect(reopened.getByTestId("game-settings-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(reopened.getByTestId("board-inner")).toHaveCSS("background-color", fieldColor);
  });
}

test("game sounds can be muted and the preference survives reopening", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.removeItem("6b-game-sounds"));
  const screen = (
    <MockGameWrapper playerColor="white" state={makeGameState({ phase: "rolling", turn: "white" })}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen);
  await component.getByTestId("game-settings-toggle").press("Enter");
  const sounds = component.getByRole("checkbox", { name: "Game sounds" });
  await expect(sounds).toBeChecked();
  await component.getByText("Game sounds", { exact: true }).click();
  await expect(sounds).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("6b-game-sounds"))).toBe("false");
  await component.unmount();
  const reopened = await mount(screen);
  await reopened.getByTestId("game-settings-toggle").press("Enter");
  await expect(reopened.getByRole("checkbox", { name: "Game sounds" })).not.toBeChecked();
});

for (const [theme, expectedAccent] of [
  ["brownGold", "#dfaf63"],
  ["charcoalGold", "#d6ae63"],
  ["blueIvory", "#2448ff"],
] as const) {
  test(`opening result shows both dice and uses the ${theme} theme`, async ({ mount, page }) => {
    await page.evaluate((selectedTheme) => {
      if (selectedTheme === "brownGold") localStorage.removeItem("6b-board-theme");
      else localStorage.setItem("6b-board-theme", selectedTheme);
    }, theme);
    const component = await mount(
      <MockGameWrapper
        playerColor="white"
        state={makeGameState({
          phase: "opening_result",
          turn: "white",
          openingRoll: { white: 5, black: 3 },
        })}
      >
        <GameScreen />
      </MockGameWrapper>,
    );
    await expect(component.getByTestId("guidance-banner")).toHaveCount(0);
    await expect(component.getByTestId("opening-result-overlay")).toHaveText("You go first!");
    const openingDice = component.locator('[data-roll-kind="opening"]');
    await expect(openingDice.locator('[data-testid="die"]')).toHaveCount(2);
    await expect(openingDice.locator('[data-dice-throw-active="true"]')).toHaveCount(0);
    await expect(openingDice.and(component.locator('[data-roll-owner="self"]')).getByTestId("die")).toHaveAttribute("data-die-value", "5");
    await expect(openingDice.and(component.locator('[data-roll-owner="opponent"]')).getByTestId("die")).toHaveAttribute("data-die-value", "3");
    const accent = await component
      .getByTestId("opening-result-overlay")
      .evaluate((element) => getComputedStyle(element).getPropertyValue("--ui-accent").trim());
    expect(accent).toBe(expectedAccent);
  });
}

test("each opening die arrives on its half and the first move reuses the deciding pair", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const waiting = makeGameState({ phase: "opening_roll", turn: "white", points: new Array(24).fill(0) });
  const render = (state: typeof waiting) => (
    <MockGameWrapper playerColor="white" state={state}>
      <GameScreen />
    </MockGameWrapper>
  );
  const board = await mount(render(waiting));
  await board.update(render({ ...waiting, turn: "black", openingRoll: { white: 5, black: null } }));
  const white = board.locator('[data-overlay-side="right"] [data-roll-kind="opening"]');
  const black = board.locator('[data-overlay-side="left"] [data-roll-kind="opening"]');
  await expect(white.locator('[data-dice-throw-active="true"]')).toHaveCount(1);
  await expect(black).toHaveCount(0);
  await white.evaluate(node => node.setAttribute("data-first-observed", "true"));

  const decided = {
    ...waiting, phase: "opening_result" as const, openingRoll: { white: 5, black: 3 },
    dice: [5, 3], remaining: [5, 3],
  };
  await board.update(render(decided));
  await expect(white).toHaveAttribute("data-first-observed", "true");
  await expect(black.locator('[data-dice-throw-active="true"]')).toHaveCount(1);
  await board.update(render({ ...decided, phase: "moving" }));
  await expect(board.locator('[data-roll-kind="opening"]')).toHaveCount(0);
  const playable = board.locator('[data-overlay-side="right"] [data-roll-kind="live"]').getByTestId("die");
  await expect(playable).toHaveCount(2);
  await expect(playable.first()).toHaveAttribute("data-die-value", "5");
  await expect(playable.nth(1)).toHaveAttribute("data-die-value", "3");
  await expect(board.getByTestId("rolling-die")).toHaveCount(0);
});

test("an observed opening tie clears for the next attempt even if a face repeats", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const waiting = makeGameState({ phase: "opening_roll", turn: "white" });
  const render = (state: typeof waiting) => (
    <MockGameWrapper playerColor="white" state={state}>
      <GameScreen />
    </MockGameWrapper>
  );
  const board = await mount(render(waiting));
  const first = { ...waiting, turn: "black" as const, openingRoll: { white: 4, black: null } };
  await board.update(render(first));
  await board.update(render({ ...waiting, message: "Tie - roll again" }));
  await expect(board.getByTestId("opening-tie-status")).toBeVisible();
  const dice = board.locator('[data-roll-kind="opening"]').getByTestId("die");
  await expect(dice).toHaveCount(2);
  await expect(dice.first()).toHaveAttribute("data-die-value", "4");
  await expect(dice.nth(1)).toHaveAttribute("data-die-value", "4");
  await board.update(render(first));
  await expect(board.getByTestId("opening-tie-status")).toHaveCount(0);
  await expect(dice).toHaveCount(1);
});

test("opening roll starts automatically without showing a roll action", async ({
  mount,
}) => {
  let rolls = 0;
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_roll",
        turn: "white",
        openingRoll: { white: null, black: null },
      })}
      context={{ rollDice: () => rolls++ }}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("guidance-banner")).toHaveCount(0);
  await expect(component.getByTitle("Tap to roll")).toHaveCount(0);
  await expect.poll(() => rolls).toBe(1);
});

test("recovers an interrupted opening move instead of requesting a new roll", async ({
  mount,
}) => {
  let recoveries = 0;
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "rolling",
        turn: "white",
        openingRoll: { white: 5, black: 2 },
        dice: [],
        remaining: [],
        lastMove: null,
        moveHistory: null,
        message: "white goes first",
      })}
      context={{ rollDice: () => recoveries++ }}
    >
      <GameScreen />
    </MockGameWrapper>,
  );

  await expect(component.getByTitle("Tap to roll")).toHaveCount(0);
  await expect.poll(() => recoveries).toBe(1);
});

test("roll action remains available after a server auto-pass with stale dice", async ({
  mount, page,
}) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "false"));
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "rolling",
        turn: "white",
        dice: [2, 4],
        remaining: [],
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("guidance-banner")).toHaveCount(0);
  await expect(component.getByTitle("Tap to roll")).toBeVisible();
});

test("auto roll starts immediately without doubling and preserves its preference", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.removeItem("bg_auto_roll"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const screen = (
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white", doublingEnabled: false })}
      context={{ rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen);
  await component.getByTestId("game-settings-toggle").press("Enter");
  const toggle = component.getByTestId("auto-roll-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(1500);
  expect(rolls).toBe(0);
  await toggle.click();
  await expect.poll(() => rolls).toBe(1);
  await toggle.click();
  await page.clock.runFor(1000);
  expect(rolls).toBe(1);
  await toggle.click();
  await expect.poll(() => rolls).toBe(1);
  await page.clock.runFor(3000);
  expect(rolls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("bg_auto_roll"))).toBe("true");
  await component.unmount();
  const reopened = await mount(screen);
  await expect(reopened.getByTestId("auto-roll-toggle")).toHaveAttribute("aria-pressed", "true");
});

test("a manual roll cancels the doubling window and sends only once", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  let doubles = 0;
  const component = await mount(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++, offerDouble: () => doubles++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10");
  await page.clock.runFor(9999);
  expect(rolls).toBe(0);
  await component.getByTitle("Tap to roll").click();
  await expect.poll(() => rolls).toBe(1);
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await component.getByTitle("Tap to roll").click();
  await component.getByRole("button", { name: "Offer double to opponent", exact: true }).click();
  await page.clock.runFor(10001);
  expect(rolls).toBe(1);
  expect(doubles).toBe(0);
});

test("auto roll proceeds while the opponent's blocked notice is visible", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const state = makeGameState({ phase: "rolling", turn: "white", dice: [2, 4], remaining: [], doublingEnabled: false });
  const component = await mount(
    <MockGameWrapper state={state} context={{
      rollDice: () => rolls++,
      noMovesMessage: { color: "black", dice: [2, 4], remaining: [2, 4] },
    }}><GameScreen /></MockGameWrapper>,
  );
  await expect(component.getByTestId("no-moves-overlay")).toBeVisible();
  await expect(component.getByTitle("Tap to roll")).toBeVisible();
  await expect.poll(() => rolls).toBe(1);
  await expect(component.getByTestId("no-moves-overlay")).toBeVisible();
});

test("auto roll waits for an error to clear and retries immediately once", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const screen = (error: string | null) => (
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white", doublingEnabled: false })}
      context={{ error, rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen("Dice service unavailable"));
  expect(rolls).toBe(0);
  await component.update(screen(null));
  await expect.poll(() => rolls).toBe(1);
  await component.update(screen(null));
  expect(rolls).toBe(1);
  await component.update(screen("Dice service unavailable"));
  await component.update(screen(null));
  await expect.poll(() => rolls).toBe(2);
});

for (const playerColor of ["white", "black"] as const) {
  test(`auto roll gives ${playerColor} exactly 10 seconds to double under StrictMode`, async ({ mount, page }) => {
    await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let rolls = 0;
    const component = await mount(
      <StrictMode>
        <MockGameWrapper playerColor={playerColor}
          state={makeGameState({ phase: "rolling", turn: playerColor })}
          context={{ rollDice: () => rolls++ }}>
          <GameScreen />
        </MockGameWrapper>
      </StrictMode>,
    );
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("Rolling automatically in 10s…");
    await expect(component.getByRole("button", { name: "Offer double to opponent", exact: true })).toBeEnabled();
    await page.clock.runFor(9999);
    expect(rolls).toBe(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("1s");
    await page.clock.runFor(1);
    await expect.poll(() => rolls).toBe(1);
    await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
    await page.clock.runFor(10000);
    expect(rolls).toBe(1);
  });

  test(`auto roll starts a fresh doubling window when the turn returns to ${playerColor}`, async ({ mount, page }) => {
    await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let rolls = 0;
    const opponent = playerColor === "white" ? "black" : "white";
    const screen = (turn: typeof playerColor | typeof opponent) => (
      <MockGameWrapper playerColor={playerColor}
        state={makeGameState({ phase: "rolling", turn })}
        context={{ rollDice: () => rolls++ }}>
        <GameScreen />
      </MockGameWrapper>
    );
    const component = await mount(screen(opponent));
    expect(rolls).toBe(0);
    await component.update(screen(playerColor));
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
    await page.clock.fastForward(4000);
    await component.update(screen(opponent));
    await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
    await page.clock.fastForward(10000);
    expect(rolls).toBe(0);
    await component.update(screen(playerColor));
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
    await page.clock.fastForward(4000);
    await component.update(screen(playerColor));
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("6s");
    await page.clock.fastForward(5999);
    expect(rolls).toBe(0);
    await page.clock.runFor(1);
    await expect.poll(() => rolls).toBe(1);
    await component.update(screen(playerColor));
    expect(rolls).toBe(1);
    await component.update(screen(opponent));
    expect(rolls).toBe(1);
    await component.update(screen(playerColor));
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
    await page.clock.fastForward(9999);
    expect(rolls).toBe(1);
    await page.clock.runFor(1);
    await expect.poll(() => rolls).toBe(2);
    await component.getByTestId("game-settings-toggle").press("Enter");
    await component.getByTestId("auto-roll-toggle").click();
    await component.update(screen(opponent));
    await component.update(screen(playerColor));
    await page.clock.fastForward(10000);
    expect(rolls).toBe(2);
  });
}

test("turning auto roll off cancels the pending doubling window", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const component = await mount(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await page.clock.fastForward(9000);
  await component.getByTestId("game-settings-toggle").press("Enter");
  await component.getByTestId("auto-roll-toggle").click();
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await page.clock.fastForward(10000);
  expect(rolls).toBe(0);
  await component.getByTestId("auto-roll-toggle").click();
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await page.clock.fastForward(9999);
  expect(rolls).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(() => rolls).toBe(1);
});

test("club preferences update an open game and stopping auto roll leaves doubling available", async ({ mount, page }) => {
  await page.evaluate(() => {
    localStorage.setItem("bg_auto_roll", "true");
    localStorage.setItem("6b-board-theme", "classicBrown");
  });
  const now = new Date("2026-11-02T12:00:00.000Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  let rolls = 0;
  let doubles = 0;
  const component = await mount(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++, offerDouble: () => doubles++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await expect(component.getByTestId("board-frame")).toHaveAttribute("data-board-theme", "classicBrown");
  await page.clock.fastForward(9000);

  // Other tabs change the same origin's storage before the browser notifies us.
  await page.evaluate(() => {
    localStorage.setItem("bg_auto_roll", "false");
    localStorage.setItem("6b-board-theme", "classicLight");
    window.dispatchEvent(new StorageEvent("storage", { key: "bg_auto_roll" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "6b-board-theme" }));
  });
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await expect(component.getByTestId("board-frame")).toHaveAttribute("data-board-theme", "classicLight");
  await page.clock.fastForward(10000);
  expect(rolls).toBe(0);
  await component.getByRole("button", { name: "Offer double to opponent", exact: true }).click();
  await expect.poll(() => doubles).toBe(1);
  await page.clock.fastForward(10000);
  expect(rolls).toBe(0);
});

test("offering a double cancels auto roll before the server acknowledges it", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  let doubles = 0;
  const screen = () => (
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++, offerDouble: () => doubles++ }}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen());
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await page.clock.fastForward(9999);
  await component.getByRole("button", { name: "Offer double to opponent", exact: true }).click();
  await expect.poll(() => doubles).toBe(1);
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await component.update(screen());
  await component.getByRole("button", { name: "Offer double to opponent", exact: true }).click();
  await component.getByTitle("Tap to roll").click();
  await page.clock.fastForward(20001);
  expect(rolls).toBe(0);
  expect(doubles).toBe(1);
  await component.update(
    <MockGameWrapper state={makeGameState({ phase: "doubling_offered", turn: "white", doubleOfferedBy: "white" })}
      context={{ rollDice: () => rolls++, offerDouble: () => doubles++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await component.update(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white", cube: 2, cubeOwner: "black" })}
      context={{ rollDice: () => rolls++, offerDouble: () => doubles++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect.poll(() => rolls).toBe(1);
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
});

test("a fully closed bar still passes immediately with auto roll enabled", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const points = Array<number>(24).fill(0);
  for (let entry = 18; entry < 24; entry++) points[entry] = -2;
  points[5] = 14;
  points[11] = -3;
  let rolls = 0;
  const component = await mount(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white", points, bar: { white: 1, black: 0 } })}
      context={{ rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect.poll(() => rolls).toBe(1);
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await page.clock.runFor(10000);
  expect(rolls).toBe(1);
});

for (const [reason, state, context] of [
  ["disabled", { doublingEnabled: false }, {}],
  ["owned by the opponent", { cubeOwner: "black" }, {}],
  ["Crawford", { crawfordGame: true }, {}],
  ["at the cube limit", { cube: 64, maxCube: 64 }, {}],
  ["dead for this player", { cube: 4 }, { targetPoints: 3, matchScore: { white: 0, black: 0 } }],
] as const) {
  test(`auto roll stays immediate when doubling is ${reason}`, async ({ mount, page }) => {
    await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let rolls = 0;
    const component = await mount(
      <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white", ...state })}
        context={{ ...context, rollDice: () => rolls++ }}>
        <GameScreen />
      </MockGameWrapper>,
    );
    await expect.poll(() => rolls).toBe(1);
    await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
    await page.clock.runFor(10000);
    expect(rolls).toBe(1);
  });
}

for (const [reason, pausedContext] of [
  ["loading", { isLoading: true }],
  ["an error", { error: "Dice service unavailable" }],
  ["opponent disconnection", { opponentConnected: false }],
] as const) {
  test(`auto roll clears the doubling window during ${reason}`, async ({ mount, page }) => {
    await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let rolls = 0;
    const screen = (paused: boolean) => (
      <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
        context={{ ...(paused ? pausedContext : {}), rollDice: () => rolls++ }}>
        <GameScreen />
      </MockGameWrapper>
    );
    const component = await mount(screen(false));
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
    // The countdown reads a deadline, so replaying every frame is unnecessary.
    await page.clock.fastForward(9000);
    await component.update(screen(true));
    await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
    await page.clock.fastForward(10000);
    expect(rolls).toBe(0);
    await component.update(screen(false));
    await page.clock.runFor(0);
    await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
    await page.clock.fastForward(9999);
    expect(rolls).toBe(0);
    await page.clock.runFor(1);
    await expect.poll(() => rolls).toBe(1);
  });
}

test("changing rooms cancels the old countdown and gives the new room 10 seconds", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const rolls: string[] = [];
  const screen = (roomId: string) => (
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ roomId, rollDice: () => rolls.push(roomId) }}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen("first"));
  await page.clock.runFor(9000);
  await component.update(screen("second"));
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await page.clock.runFor(9999);
  expect(rolls).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => rolls).toEqual(["second"]);
});

test("changing players cancels the old countdown", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const screen = (playerColor: "white" | "black") => (
    <MockGameWrapper playerColor={playerColor}
      state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>
  );
  const component = await mount(screen("white"));
  await page.clock.runFor(9000);
  await component.update(screen("black"));
  await expect(component.getByTestId("auto-roll-countdown")).toHaveCount(0);
  await page.clock.runFor(10000);
  expect(rolls).toBe(0);
});

test("unmounting the game cancels its pending automatic roll", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "true"));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let rolls = 0;
  const component = await mount(
    <MockGameWrapper state={makeGameState({ phase: "rolling", turn: "white" })}
      context={{ rollDice: () => rolls++ }}>
      <GameScreen />
    </MockGameWrapper>,
  );
  await page.clock.runFor(0);
  await expect(component.getByTestId("auto-roll-countdown")).toContainText("10s");
  await page.clock.runFor(9999);
  await component.unmount();
  await page.clock.runFor(10001);
  expect(rolls).toBe(0);
});

test("in-game errors show as a floating card and keep the board visible", async ({
  mount,
}) => {
  const component = await mount(<ErrorCardHarness />);
  await expect(component.getByTestId("error-card")).toContainText("Cannot double");
  await expect(component.getByTestId("board-frame")).toBeVisible();
});

test("close button dismisses the error card", async ({ mount }) => {
  const component = await mount(<ErrorCardHarness />);
  await component.getByTestId("error-card-close").click();
  await expect(component.getByTestId("error-card")).toHaveCount(0);
  await expect(component.getByTestId("board-frame")).toBeVisible();
});

test("fatal connection error with no game state still blocks the screen", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      context={{ state: null, error: "Failed to connect" }}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByText("Error: Failed to connect")).toBeVisible();
  await expect(component.getByTestId("error-card")).toHaveCount(0);
});

test("final match score is capped at targetPoints for 1-point 1v1", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      context={{
        gameResult: {
          winner: "black",
          winType: "single",
          points: 1,
          cube: 1,
          matchScore: { white: 0, black: 3 },
          targetPoints: 1,
          matchOver: true,
          gameType: "1v1",
        },
      }}
      state={makeGameState({ phase: "game_over", winner: "black" })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("score-left")).toHaveText("0");
  await expect(component.getByTestId("score-right")).toHaveText("1");
});

test("final match score is capped at targetPoints for 5-point 1v1", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      context={{
        gameResult: {
          winner: "black",
          winType: "single",
          points: 1,
          cube: 1,
          matchScore: { white: 0, black: 6 },
          targetPoints: 5,
          matchOver: true,
          gameType: "1v1",
        },
      }}
      state={makeGameState({ phase: "game_over", winner: "black" })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("score-left")).toHaveText("0");
  await expect(component.getByTestId("score-right")).toHaveText("5");
});

test("final match score below target is not capped", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      context={{
        gameResult: {
          winner: "white",
          winType: "single",
          points: 1,
          cube: 1,
          matchScore: { white: 3, black: 2 },
          targetPoints: 5,
          matchOver: true,
          gameType: "1v1",
        },
      }}
      state={makeGameState({ phase: "game_over", winner: "white" })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("score-left")).toHaveText("3");
  await expect(component.getByTestId("score-right")).toHaveText("2");
});

test("quick game score is not capped at targetPoints", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      context={{
        gameResult: {
          winner: "black",
          winType: "single",
          points: 1,
          cube: 1,
          matchScore: { white: 0, black: 6 },
          targetPoints: 5,
          matchOver: true,
          gameType: "quick",
        },
      }}
      state={makeGameState({ phase: "game_over", winner: "black" })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("score-left")).toHaveText("0");
  await expect(component.getByTestId("score-right")).toHaveText("6");
});
