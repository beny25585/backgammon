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

test("does not request or display PR during gameplay", async ({ mount, page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/performance/**", async (route) => {
    requests += 1;
    await route.fulfill({ json: { players: {
      white: { pr: "2.5", matches: 4, decisions: 40 },
      black: { pr: "4", matches: 5, decisions: 50 },
    } } });
  });
  const component = await mount(
    <MockGameWrapper playerColor="black" context={{ roomId: "11111111-1111-1111-1111-111111111111" }}>
      <SidePanel state={makeState()} playerColor="black" />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("player-name-black")).toBeVisible();
  await page.clock.runFor(10_000);
  await expect(component.getByTestId("player-pr-white")).toHaveCount(0);
  await expect(component.getByTestId("player-pr-black")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("loads rating and balance once and displays money limits for both seats", async ({ mount, page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/rooms/*/player-details/", async (route) => {
    requests += 1;
    await route.fulfill({ json: { players: {
      white: { rating: 1562, balance: "65800.00" },
      black: { rating: 1063, balance: "3770.00" },
    } } });
  });
  const component = await mount(
    <MockGameWrapper playerColor="black" context={{ roomId: "11111111-1111-1111-1111-111111111111" }}>
      <SidePanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00" })} playerColor="black" />
    </MockGameWrapper>,
  );
  await expect(component.locator('[data-player="self"]').getByTestId("player-rating-black")).toHaveText("1063");
  await expect(component.locator('[data-player="opponent"]').getByTestId("player-rating-white")).toHaveText("1562");
  await expect(component.getByTestId("player-balance-white")).toHaveText("65.8K");
  await expect(component.getByTestId("player-balance-black")).toHaveText("3.77K");
  await expect(component.getByTestId("game-stakes")).toContainText("Stake100");
  await expect(component.getByTestId("game-stakes")).toContainText("Limit1.6K");
  await component.update(
    <MockGameWrapper playerColor="black" context={{ roomId: "11111111-1111-1111-1111-111111111111" }}>
      <SidePanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00", remaining: [2], version: 2 })} playerColor="black" />
    </MockGameWrapper>,
  );
  await page.clock.runFor(10_000);
  expect(requests).toBe(1);
});

test("shows the points target and rules without inventing accounts in a local match", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper context={{ targetPoints: 7 }}><SidePanel state={makeState({ gameFormat: "match", doublingEnabled: true })} playerColor="white" /></MockGameWrapper>,
  );
  await expect(component.getByTestId("game-info-card")).toBeVisible();
  await expect(component.getByTestId("match-target")).toHaveText("7 points");
  await expect(component.getByTestId("match-doubling-rule")).toHaveText("Doubling on");
  await expect(component.getByTestId("game-stakes")).toHaveCount(0);
  await expect(component.getByTestId("player-rating-white")).toHaveCount(0);
  await expect(component.getByTestId("player-balance-white")).toHaveCount(0);
});

test("points rules respect disabled doubling and the Crawford game", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper context={{ targetPoints: 5 }}><SidePanel state={makeState({ doublingEnabled: false })} playerColor="white" /></MockGameWrapper>,
  );
  await expect(component.getByTestId("match-target")).toHaveText("5 points");
  await expect(component.getByTestId("match-doubling-rule")).toHaveText("No doubling");
  await component.update(
    <MockGameWrapper context={{ targetPoints: 5 }}><SidePanel state={makeState({ doublingEnabled: true, crawfordGame: true })} playerColor="white" /></MockGameWrapper>,
  );
  await expect(component.getByTestId("match-doubling-rule")).toHaveText("Crawford · No doubling");
});

test("failed account reads can be retried without showing zero balances", async ({ mount, page }) => {
  let requests = 0;
  await page.route("**/api/rooms/*/player-details/", async (route) => {
    requests += 1;
    await route.fulfill(requests === 1 ? { status: 503, json: {} } : { json: { players: {
      white: { rating: 1000, balance: "0.00" },
    } } });
  });
  const component = await mount(
    <MockGameWrapper context={{ roomId: "11111111-1111-1111-1111-111111111111" }}>
      <SidePanel state={makeState()} playerColor="white" />
    </MockGameWrapper>,
  );
  await expect(component.getByRole("button", { name: "Retry rating and balance" })).toBeVisible();
  await expect(component.getByTestId("player-balance-white")).toHaveCount(0);
  await component.getByRole("button", { name: "Retry rating and balance" }).click();
  await expect(component.getByTestId("player-balance-white")).toHaveText("0");
});

test("shows usernames for both players when provided", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white" context={{ whiteName: "alice", blackName: "bob" }}>
      <SidePanel state={makeState()} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("player-name-white")).toHaveText("alice");
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
  await expect(component.getByRole("button", { name: "Install app" })).toHaveCount(0);
  await component.getByRole("button", { name: "Match control" }).click();
  await expect(component.getByRole("button", { name: "Language" })).toBeVisible();
  await expect(component.getByRole("button", { name: "Install app" })).toBeVisible();
});
