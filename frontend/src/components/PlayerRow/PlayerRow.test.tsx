import { test, expect } from "@playwright/experimental-ct-react";
import PlayerRow from "./PlayerRow";
import { makeGameState } from "../../test-utils/wrappers";

test("shows the player's chips and score", async ({ mount }) => {
  const row = await mount(
    <PlayerRow
      color="white"
      state={makeGameState({ turn: "black", home: { white: 5, black: 8 }, bar: { white: 1, black: 0 } })}
      label="You (White)"
      active={false}
      self
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
