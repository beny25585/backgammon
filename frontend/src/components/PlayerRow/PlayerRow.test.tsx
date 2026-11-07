import { test, expect } from "@playwright/experimental-ct-react";
import PlayerRow from "./PlayerRow";
import { makeGameState } from "../../test-utils/gameState";

test("shows the player's chips and score", async ({ mount }) => {
  const row = await mount(
    <PlayerRow
      color="white"
      state={makeGameState({ turn: "black", home: { white: 5, black: 8 }, bar: { white: 1, black: 0 } })}
      label="You (White)"
      active={false}
      self
      score={0}
    />,
  );
  await expect(row.getByText("Off 5")).toBeVisible();
  await expect(row.getByText("Bar 1")).toBeVisible();
  await expect(row.getByText("0")).toBeVisible();
});

test("shows the provided match score", async ({ mount }) => {
  const row = await mount(
    <PlayerRow
      color="white"
      state={makeGameState({ turn: "black" })}
      label="You (White)"
      active={false}
      self
      score={4}
    />,
  );
  await expect(row.getByTestId("player-score-white")).toHaveText("4");
});

test("does not render a clock", async ({ mount }) => {
  const row = await mount(
    <PlayerRow
      color="white"
      state={makeGameState({ turn: "black" })}
      label="You (White)"
      active={false}
      self
    />,
  );
  await expect(row.getByText("--:--")).not.toBeVisible();
});

test("shows the turn badge for the active player", async ({ mount }) => {
  const row = await mount(
    <PlayerRow
      color="white"
      state={makeGameState({ turn: "white" })}
      label="You (White)"
      active
      self
    />,
  );
  await expect(row.getByText("Your Turn")).toBeVisible();
});

test("centers the player details on a wide rail and fits the turn label on a short rail", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = makeGameState({ turn: "white" });
  const renderRail = (height: number, width: number) => (
    <div style={{ width: 1280, height, containerType: "size", containerName: "game-layout game-frame" }}>
      <div style={{ width, containerType: "inline-size" }}>
        <PlayerRow color="white" state={state} label="LocalPlayerWithALongName" active self score={8} />
      </div>
    </div>
  );
  const component = await mount(renderRail(800, 160));
  const player = component.getByRole("group", { name: "You" });
  const name = player.getByTestId("player-name-white");
  const score = player.getByTestId("player-score-white");
  const turn = player.getByText("Your turn");
  const wideBox = await player.boundingBox();
  expect(wideBox).not.toBeNull();
  const center = wideBox!.x + wideBox!.width / 2;
  for (const item of [name, score, turn, player.locator('span[aria-hidden="true"][data-active]')]) {
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width / 2).toBeCloseTo(center, 0);
  }

  await component.update(renderRail(330, 88));
  await expect(turn).toBeVisible();
  await expect(score).toBeVisible();
  const compactBox = await player.boundingBox();
  const scoreBox = await score.boundingBox();
  expect(compactBox).not.toBeNull();
  expect(scoreBox).not.toBeNull();
  expect(compactBox!.height).toBeCloseTo(scoreBox!.height, 0);
});
