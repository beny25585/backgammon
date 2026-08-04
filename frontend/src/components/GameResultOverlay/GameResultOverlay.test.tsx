import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter } from "react-router-dom";
import { LocalGameProvider } from "../../services/localGameContext";
import SidePanel from "../SidePanel/SidePanel";
import { GameOverProbe } from "../../test-utils/probes";
import { gameOverFixture } from "../../test-utils/fixtures";

test("shows a single result overlay with the live match score", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={7}>
      <GameOverProbe />
    </LocalGameProvider>,
  );

  await expect(component.getByText("You Win!")).toBeVisible();
  await expect(component.getByText("Match Won!")).not.toBeVisible();
  await expect(component.getByText("You: 4")).toBeVisible();
  await expect(component.getByText("Bot: 0")).toBeVisible();
  await expect(component.getByText("Next Game →")).toBeVisible();
  await expect(component.getByText("Back to Home")).not.toBeVisible();
});

test("shows the match-over overlay when the target is reached", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={1}>
      <GameOverProbe />
    </LocalGameProvider>,
  );

  await expect(component.getByText("Match Won!")).toBeVisible();
  await expect(component.getByText("Back to Home")).toBeVisible();
  await expect(component.getByText("Next Game →")).not.toBeVisible();
});

test("counts down before auto-advancing to the next game", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <LocalGameProvider matchTarget={7}>
      <GameOverProbe />
    </LocalGameProvider>,
  );

  await expect(component.getByText("Next game starts automatically in 30s")).toBeVisible();
  await page.clock.fastForward(3000);
  await expect(component.getByText("Next game starts automatically in 27s")).toBeVisible();
});

test("player rows update to the live match score after a game ends", async ({ mount }) => {
  const component = await mount(
    <MemoryRouter>
      <LocalGameProvider matchTarget={7}>
        <GameOverProbe />
        <SidePanel state={gameOverFixture} playerColor="white" onLeave={() => {}} />
      </LocalGameProvider>
    </MemoryRouter>,
  );

  await expect(component.getByTestId("player-score-white")).toHaveText("4");
  await expect(component.getByTestId("player-score-black")).toHaveText("0");
});
