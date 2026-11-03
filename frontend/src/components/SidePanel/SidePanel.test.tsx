import { test, expect } from "@playwright/experimental-ct-react";
import SidePanel from "./SidePanel";
import GameSettingsPanel from "./GameSettingsPanel";
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

test("loads accounts once in the menu while money limits remain in the rail", async ({ mount, page }) => {
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
      <div>
        <SidePanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00" })} playerColor="black" />
        <GameSettingsPanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00" })} />
      </div>
    </MockGameWrapper>,
  );
  const accounts = component.getByTestId("game-player-accounts");
  await expect(accounts.locator('[data-player="self"]').getByTestId("player-rating-black")).toHaveText("1063");
  await expect(accounts.locator('[data-player="opponent"]').getByTestId("player-rating-white")).toHaveText("1562");
  await expect(component.getByTestId("side-panel").getByTestId("player-rating-black")).toHaveCount(0);
  await expect(component.getByTestId("side-panel").getByTestId("player-balance-white")).toHaveCount(0);
  await expect(component.getByTestId("player-balance-white")).toHaveText("65.8K");
  await expect(component.getByTestId("player-balance-black")).toHaveText("3.77K");
  await expect(component.getByTestId("game-stakes")).toContainText("Stake100");
  await expect(component.getByTestId("game-stakes")).toContainText("Limit1.6K");
  await component.update(
    <MockGameWrapper playerColor="black" context={{ roomId: "11111111-1111-1111-1111-111111111111" }}>
      <div>
        <SidePanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00", remaining: [2], version: 2 })} playerColor="black" />
        <GameSettingsPanel state={makeState({ gameFormat: "money", stake: "100.00", lossLimit: "1600.00", remaining: [2], version: 2 })} />
      </div>
    </MockGameWrapper>,
  );
  await page.clock.runFor(10_000);
  expect(requests).toBe(1);
});

test("keeps the target in the rail and moves ordinary rules and progress to the menu", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper context={{ targetPoints: 7 }}>
      <div>
        <SidePanel state={makeState({ gameFormat: "match", doublingEnabled: true })} playerColor="white" />
        <GameSettingsPanel state={makeState({ gameFormat: "match", doublingEnabled: true })} />
      </div>
    </MockGameWrapper>,
  );
  const rail = component.getByTestId("side-panel");
  const menu = component.getByTestId("game-settings-panel");
  await expect(rail.getByTestId("game-info-card")).toBeVisible();
  await expect(rail.getByTestId("match-target")).toHaveText("7 points");
  await expect(rail.getByTestId("match-doubling-rule")).toHaveCount(0);
  await expect(rail.getByRole("progressbar")).toHaveCount(0);
  await expect(menu.getByTestId("match-doubling-rule")).toHaveText("Doubling on");
  await expect(menu.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "7");
  await expect(component.getByTestId("game-stakes")).toHaveCount(0);
  await expect(component.getByTestId("player-rating-white")).toHaveCount(0);
  await expect(component.getByTestId("player-balance-white")).toHaveCount(0);
});

test("ordinary rules stay in the menu while Crawford remains visible in the rail", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper context={{ targetPoints: 5 }}>
      <div>
        <SidePanel state={makeState({ doublingEnabled: false })} playerColor="white" />
        <GameSettingsPanel state={makeState({ doublingEnabled: false })} />
      </div>
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("match-target")).toHaveText("5 points");
  await expect(component.getByTestId("side-panel").getByTestId("match-doubling-rule")).toHaveCount(0);
  await expect(component.getByTestId("game-settings-panel").getByTestId("match-doubling-rule")).toHaveText("No doubling");
  await component.update(
    <MockGameWrapper context={{ targetPoints: 5 }}>
      <div>
        <SidePanel state={makeState({ doublingEnabled: true, crawfordGame: true })} playerColor="white" />
        <GameSettingsPanel state={makeState({ doublingEnabled: true, crawfordGame: true })} />
      </div>
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("side-panel").getByTestId("match-doubling-rule")).toHaveText("Crawford");
  await expect(component.getByTestId("side-panel").getByTestId("match-doubling-rule")).toHaveAttribute("aria-label", "Crawford · No doubling");
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
      <GameSettingsPanel state={makeState()} />
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
      <SidePanel state={makeState()} playerColor="white" />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("player-name-white")).toHaveText("alice");
  await expect(component.getByTestId("player-name-black")).toHaveText("bob");
});

test("falls back to generic labels when names are null", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel state={makeState({ turn: "black" })} playerColor="white" />
    </MockGameWrapper>,
  );

  await expect(component.getByText("You (White)")).toBeVisible();
  await expect(component.getByText("Black Player")).toBeVisible();
});

test("renders both player clocks in the player rail", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel
        state={makeState()}
        playerColor="white"
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

for (const playerColor of ["white", "black"] as const) {
test(`keeps scores in the correct seats for a ${playerColor} viewer`, async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor={playerColor} context={{ matchScore: { white: 4, black: 2 } }}>
      <SidePanel state={makeState()} playerColor={playerColor} />
    </MockGameWrapper>,
  );

  await expect(component.getByTestId("player-score-white")).toHaveText("4");
  await expect(component.getByTestId("player-score-black")).toHaveText("2");
  const opponentColor = playerColor === "white" ? "black" : "white";
  const topScore = await component.getByTestId(`player-score-${opponentColor}`).boundingBox();
  const bottomScore = await component.getByTestId(`player-score-${playerColor}`).boundingBox();
  expect(topScore!.y).toBeLessThan(bottomScore!.y);
});
}

test("settings are available immediately without an opening button", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <GameSettingsPanel state={makeState()} onLeave={() => {}} />
    </MockGameWrapper>,
  );
  await expect(component.getByRole("button", { name: "Match control" })).toHaveCount(0);
  await expect(component.getByRole("combobox", { name: "Language" })).toBeVisible();
  await expect(component.getByRole("button", { name: "Install app" })).toBeVisible();
});

for (const [gameFormat, label, warning] of [
  ["match", "Leave and forfeit match", "Leave and forfeit the entire match? This counts as a match loss."],
  ["money", "Leave and forfeit game", "Leave and forfeit this game? This counts as a loss under the game and stake rules."],
] as const) {
  test(`leaving a ${gameFormat} requires confirmation and submits only once`, async ({ mount }) => {
    let leaves = 0;
    let giveUps = 0;
    const component = await mount(
      <MockGameWrapper context={{ giveUp: () => { giveUps += 1; } }}>
        <GameSettingsPanel state={makeState({ gameFormat })} onLeave={() => { leaves += 1; }} />
      </MockGameWrapper>,
      { hooksConfig: { locale: "en" } },
    );
    const leave = component.getByRole("button", { name: label, exact: true });
    await leave.click();
    const confirmation = component.getByRole("group", { name: warning, exact: true });
    await expect(confirmation).toBeVisible();
    expect(leaves).toBe(0);
    await confirmation.getByRole("button", { name: "No", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(leaves).toBe(0);
    await leave.click();
    await confirmation.getByRole("button", { name: "Yes", exact: true }).evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect.poll(() => leaves).toBe(1);
    await expect(confirmation).toHaveCount(0);
    expect(giveUps).toBe(0);
  });
}
