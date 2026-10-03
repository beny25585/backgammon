import { test, expect } from "@playwright/experimental-ct-react";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { makeGameState } from "../../test-utils/gameState";
import { ErrorCardHarness } from "../../test-utils/probes";
import { DEFAULT_BOARD_THEME } from "../BoardThemeSelector/boardThemes";

test("blue and ivory is the default board theme", () => {
  expect(DEFAULT_BOARD_THEME).toBe("blueIvory");
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
    await component.getByRole("button", { name: "Match control" }).click();
    const option = component.getByRole("button", { name: label });
    await option.scrollIntoViewIfNeeded();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(component.getByTestId("board-inner")).toHaveCSS("background-color", fieldColor);
    await expect(component.getByTestId("doubling-cube")).toHaveCSS("color", "rgb(255, 244, 207)");
    await expect(component.getByRole("button", { name: "Blue and ivory" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const drawerWidth = await component.getByTestId("match-control-drawer").evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    expect(drawerWidth).toBeLessThanOrEqual(280);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("6b-board-theme"))).toBe(theme);
    await component.unmount();
    const reopened = await mount(screen);
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
  await component.getByRole("button", { name: "Match control" }).click();
  const sounds = component.getByRole("checkbox", { name: "Game sounds" });
  await sounds.scrollIntoViewIfNeeded();
  await expect(sounds).toBeChecked();
  await sounds.uncheck();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("6b-game-sounds"))).toBe("false");
  await component.unmount();
  const reopened = await mount(screen);
  await reopened.getByRole("button", { name: "Match control" }).click();
  await expect(reopened.getByRole("checkbox", { name: "Game sounds" })).not.toBeChecked();
});

test("opening result shows both dice and uses the selected theme", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.removeItem("6b-board-theme"));
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_result",
        turn: "white",
        openingRoll: { white: 5, black: 3 },
      })}
      context={{
        openingRollResult: { myDie: 5, opponentDie: 3, winner: "white" },
      }}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("guidance-banner")).toHaveCount(0);
  await expect(component.getByTestId("opening-result-overlay")).toBeVisible();
  await expect(
    component.getByTestId("opening-result-overlay").getByText("Opponent"),
  ).toBeVisible();
  await expect(
    component.getByTestId("opening-result-overlay").locator("[data-testid='die']"),
  ).toHaveCount(2);
  const accent = await component
    .getByTestId("opening-result-overlay")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--ui-accent").trim());
  expect(accent).toBe("#2448ff");
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
