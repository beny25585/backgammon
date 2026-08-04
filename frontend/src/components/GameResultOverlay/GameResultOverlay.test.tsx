import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter } from "react-router-dom";
import { LocalGameProvider } from "../../services/localGameContext";
import SidePanel from "../SidePanel/SidePanel";
import { GameOverProbe } from "../../test-utils/probes";
import { gameOverFixture } from "../../test-utils/fixtures";
import GameResultOverlay from "./GameResultOverlay";
import type { Color } from "../../lib/backgammon/engine";

function overlayProps(overrides: Record<string, unknown> = {}) {
  return {
    playerColor: "white" as Color,
    winner: "white" as Color,
    winType: "single" as const,
    points: 1,
    cube: 1,
    matchScore: { white: 1, black: 0 },
    matchTarget: 7,
    whiteName: "alice",
    blackName: "bob",
    countdown: null,
    onNext: () => {},
    onHome: () => {},
    ...overrides,
  };
}

test("shows a single result overlay with the live match score", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={7} botColor="black">
      <GameOverProbe />
    </LocalGameProvider>,
  );

  await expect(component.getByText("You Win!")).toBeVisible();
  await expect(component.getByText("Match Won!")).not.toBeVisible();
  await expect(component.getByText("Bot")).toBeVisible();
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

test("shows real usernames instead of You/Bot in the scoreboard", async ({ mount }) => {
  const component = await mount(
    <GameResultOverlay {...overlayProps()} />,
  );

  await expect(component.getByText("alice")).toBeVisible();
  await expect(component.getByText("bob")).toBeVisible();
  await expect(component.getByText("Bot:")).not.toBeVisible();
  await expect(component.getByText("You:")).not.toBeVisible();
});

test("player B (the loser) sees the correct loss view", async ({ mount }) => {
  const component = await mount(
    <GameResultOverlay {...overlayProps({ playerColor: "black", winner: "white" })} />,
  );

  await expect(component.getByText("You Lost")).toBeVisible();
  await expect(component.getByText("You Win!")).not.toBeVisible();
  await expect(component.getByText("Next Game →")).toBeVisible();
});

test("player B sees Match Lost when the match is over", async ({ mount }) => {
  const component = await mount(
    <GameResultOverlay
      {...overlayProps({
        playerColor: "black",
        winner: "white",
        matchScore: { white: 7, black: 4 },
      })}
    />,
  );

  await expect(component.getByText("Match Lost")).toBeVisible();
  await expect(component.getByText("Back to Home")).toBeVisible();
  await expect(component.getByText("Next Game →")).not.toBeVisible();
});

test("win-type line carries the points info, no +N chip", async ({ mount }) => {
  const component = await mount(
    <GameResultOverlay
      {...overlayProps({ winType: "gammon", points: 4, cube: 2 })}
    />,
  );

  await expect(component.getByText("Gammon! ×2")).toBeVisible();
  await expect(component.getByText("+4")).not.toBeVisible();
  await expect(component.getByText("Wins! → +1")).not.toBeVisible();
});

test("winner's score counts up to the new value", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <GameResultOverlay {...overlayProps({ matchScore: { white: 4, black: 0 }, points: 4 })} />,
  );

  // Animation has not started advancing — winner row starts below the target.
  await expect(component.getByTestId("score-white")).toHaveText("0");
  await page.clock.fastForward(1000);
  await expect(component.getByTestId("score-white")).toHaveText("4");
});
