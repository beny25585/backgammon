import { test, expect } from "@playwright/experimental-ct-react";
import SidePanel from "./SidePanel";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame } from "@/lib/backgammon/engine";

function makeState(overrides: Record<string, unknown> = {}) {
  const state = newGame();
  state.phase = "moving";
  state.turn = "white";
  return { ...state, ...overrides };
}

test("shows usernames for both players when provided", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white" context={{ whiteName: "alice", blackName: "bob" }}>
      <SidePanel state={makeState()} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("player-name-white")).toHaveText("alice (you)");
  await expect(component.getByTestId("player-name-black")).toHaveText("bob");
});

test("falls back to generic labels when names are null", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel state={makeState({ turn: "black" })} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByText("You (White)")).toBeVisible();
  await expect(component.getByText("Black Player")).toBeVisible();
});

test("renders the clock strip below the player rows", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel
        state={makeState()}
        playerColor="white"
        onLeave={() => {}}
        clock={{ white: 120_000, black: 65_000 }}
        timeControl={{ base: 120_000, delay: 12_000 }}
        turnStartedAt={0}
      />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("clock-my")).toBeVisible();
  await expect(component.getByTestId("clock-opp")).toBeVisible();
  await expect(component.getByTestId("clock-my")).toHaveText(/You/);
  await expect(component.getByTestId("clock-opp")).toHaveText(/Opponent/);
});

test("shows the live match score from context in both player rows", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white" context={{ matchScore: { white: 4, black: 2 } }}>
      <SidePanel state={makeState()} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("player-score-white")).toHaveText("4");
  await expect(component.getByTestId("player-score-black")).toHaveText("2");
});

test("keeps the language switcher inside the hamburger menu", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel state={makeState()} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByRole("button", { name: "Language" })).toHaveCount(0);
  await component.getByRole("button", { name: "Match control" }).click();
  await expect(component.getByRole("button", { name: "Language" })).toBeVisible();
});
