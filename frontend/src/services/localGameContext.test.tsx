import { test, expect } from "@playwright/experimental-ct-react";
import {
  OFF,
  newGame,
  type GameState,
} from "../lib/backgammon/engine";
import { LocalGameProvider } from "./localGameContext";
import { MemoryRouter } from "react-router-dom";
import GameScreen from "../components/GameScreen/GameScreen";
import {
  ClockMatchLifecycleProbe,
  ClockProbe,
  StartMidGame,
  GameProbe,
  SeedRolling,
  SeedRollingBot,
  LocalGiveUpProbe,
  StateSeedProbe,
  ForcedAutoConfirmProbe,
} from "../test-utils/probes";

test("clock does not run during the opening roll", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <LocalGameProvider matchTarget={1} timeControl={{ base: 300, delay: 0 }}>
      <ClockProbe />
    </LocalGameProvider>,
  );
  await page.clock.fastForward(5000);
  await expect(component.getByText(`clock:{"white":300,"black":300},started:null`)).toBeVisible();
});

test("timeout ends a local match even when the target is above one", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.route("**/api/matches/", (route) => route.fulfill({ json: { id: 1 } }));
  const component = await mount(
    <MemoryRouter>
      <LocalGameProvider matchTarget={5} timeControl={{ base: 300, delay: 0 }}>
        <StartMidGame />
        <ClockProbe />
        <GameScreen />
      </LocalGameProvider>
    </MemoryRouter>,
    { hooksConfig: { locale: "en" } },
  );
  await expect(component.getByText(/started:\d+$/)).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(component.getByText("Match Result")).toBeVisible();
  await expect(component.getByText(/clock:\{"white":0,/)).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(component.getByText("Match Result")).toBeVisible();
});

test("local match keeps spent bank when the next game starts", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <LocalGameProvider
      matchTarget={5}
      timeControl={{ base: 300_000, delay: 10_000 }}
    >
      <ClockMatchLifecycleProbe />
    </LocalGameProvider>,
  );

  await component.getByTestId("start-timed-game").click();
  // The clock starts in a React effect after the phase update commits.
  await expect(component.getByTestId("match-started")).toHaveText(/^\d+$/);
  await page.clock.fastForward(15_000);
  await component.getByTestId("finish-game").click();
  // Stopping the clock commits the elapsed charge in the same effect.
  await expect(component.getByTestId("match-started")).toHaveText("null");
  const spentClock = await component.getByTestId("match-clock").textContent();
  const parsed = JSON.parse(spentClock || "{}") as { white: number; black: number };
  expect(parsed.white).toBeGreaterThanOrEqual(294_900);
  expect(parsed.white).toBeLessThanOrEqual(295_000);
  expect(parsed.black).toBe(300_000);

  await page.clock.fastForward(1_500);
  await expect(component.getByTestId("match-phase")).toHaveText("opening_roll");
  await expect(component.getByTestId("match-clock")).toHaveText(spentClock || "");
  await expect(component.getByTestId("match-started")).toHaveText("null");
});

test("local give up with no borne-off checker awards gammon times cube", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={5}>
      <LocalGiveUpProbe />
    </LocalGameProvider>,
  );
  await component.getByTestId("seed-resignation").click();
  await expect(component.getByTestId("local-phase")).toHaveText("moving");
  await expect(component.getByTestId("local-cube")).toHaveText("2");
  await component.getByTestId("local-give-up").click();
  await expect(component.getByTestId("local-result")).toContainText('"winType":"gammon"');
  await expect(component.getByTestId("local-result")).toContainText('"points":4');
  await expect(component.getByTestId("local-score")).toHaveText('{"white":0,"black":4}');
});

test("one-point local result caps the displayed score while saving all awarded points", async ({ mount, page }) => {
  await page.route("**/api/matches/", (route) => route.fulfill({ json: { id: 1 } }));
  const component = await mount(
    <MemoryRouter>
      <LocalGameProvider matchTarget={1}>
        <LocalGiveUpProbe />
        <GameScreen />
      </LocalGameProvider>
    </MemoryRouter>,
    { hooksConfig: { locale: "en" } },
  );
  await component.getByTestId("seed-resignation").click();
  await expect(component.getByTestId("local-phase")).toHaveText("moving");
  const savedMatch = page.waitForRequest((request) =>
    request.url().endsWith("/api/matches/") && request.method() === "POST",
  );
  await component.getByTestId("local-give-up").click();

  await expect(component.getByTestId("score-left")).toHaveText("0");
  await expect(component.getByTestId("score-right")).toHaveText("1");
  await expect(component.getByTestId("local-score")).toHaveText('{"white":0,"black":4}');
  await expect(component.getByTestId("local-result")).toContainText('"points":4');
  expect((await savedMatch).postDataJSON()).toMatchObject({
    match_type: "local",
    owner_color: "white",
    target_points: 1,
    white_score: 0,
    black_score: 4,
    winner: "black",
  });
});

test("opening roll fetches a dice pair from the Django server", async ({ mount, page }) => {
  const requests: string[] = [];
  await page.route("**/api/dice/roll/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { dice: [4, 3] } });
  });

  const component = await mount(
    <LocalGameProvider matchTarget={1}>
      <GameProbe from={0} to={0} />
    </LocalGameProvider>,
  );

  await component.getByTestId("roll").click();
  await expect(component.getByTestId("opening-result")).toHaveText(
    '{"myDie":4,"opponentDie":null,"winner":null}',
  );
  await component.getByTestId("roll").click();

  await expect(component.getByTestId("opening-result")).toHaveText(
    '{"myDie":4,"opponentDie":3,"winner":"white"}',
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("type=opening");
});

test("after the opening result the winner plays both opening dice", async ({ mount, page }) => {
  await page.route("**/api/dice/roll/**", async (route) => {
    await route.fulfill({ json: { dice: [4, 3] } });
  });

  const component = await mount(
    <LocalGameProvider matchTarget={1}>
      <GameProbe from={0} to={0} />
    </LocalGameProvider>,
  );

  await component.getByTestId("roll").click();
  await component.getByTestId("roll").click();
  await expect(component.getByTestId("opening-result")).toHaveText(
    '{"myDie":4,"opponentDie":3,"winner":"white"}',
  );

  await expect(component.getByTestId("phase")).toHaveText("moving", {
    timeout: 5000,
  });
  await expect(component.getByTestId("dice")).toHaveText("[4,3]");
});

test("normal turn roll fetches dice from the Django server", async ({ mount, page }) => {
  const requests: string[] = [];
  await page.route("**/api/dice/roll/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { dice: [2, 5] } });
  });

  const component = await mount(
    <LocalGameProvider matchTarget={1}>
      <SeedRolling />
      <GameProbe from={0} to={0} />
    </LocalGameProvider>,
  );

  await expect(component.getByTestId("phase")).toHaveText("rolling");
  await component.getByTestId("roll").click();

  await expect(component.getByTestId("phase")).toHaveText("moving");
  await expect(component.getByTestId("dice")).toHaveText("[5,2]");
  expect(requests[0]).toContain("type=normal");
});

test("bot roll also fetches dice from the Django server", async ({ mount, page }) => {
  await page.route("**/api/dice/roll/**", async (route) => {
    await route.fulfill({ json: { dice: [3, 1] } });
  });

  const component = await mount(
    <LocalGameProvider matchTarget={1} botColor="black">
      <SeedRollingBot />
      <GameProbe from={0} to={0} />
    </LocalGameProvider>,
  );

  await expect(component.getByTestId("phase")).toHaveText("moving");
  await expect(component.getByTestId("dice")).toHaveText("[3,1]");
});

for (const blockedColor of ["white", "black"] as const) {
  test(`local ${blockedColor} blocked-bar roll stays visible for three seconds`, async ({ mount, page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let requests = 0;
    await page.route("**/api/dice/roll/**", async route => {
      requests += 1;
      await route.fulfill({ json: { dice: [2, 4] } });
    });
    const points = new Array(24).fill(0);
    for (let index = 0; index < 6; index++) {
      points[blockedColor === "white" ? 23 - index : index] = blockedColor === "white" ? -2 : 2;
    }
    const state: GameState = {
      ...newGame(), points, phase: "rolling", turn: blockedColor,
      bar: { white: blockedColor === "white" ? 1 : 0, black: blockedColor === "black" ? 1 : 0 },
    };
    const component = await mount(
      <LocalGameProvider botColor="black">
        <StateSeedProbe state={state} />
        <GameProbe from={0} to={0} />
      </LocalGameProvider>,
    );
    if (blockedColor === "white") await component.getByTestId("roll").click();
    else await page.clock.runFor(1500);
    await expect(component.getByTestId("no-moves")).toHaveText("true");
    if (blockedColor === "white") {
      await page.clock.runFor(1500);
      await expect.poll(() => requests).toBe(2);
    }
    await page.clock.runFor(blockedColor === "white" ? 1499 : 2999);
    await expect(component.getByTestId("no-moves")).toHaveText("true");
    expect(requests).toBe(blockedColor === "white" ? 2 : 1);
    await page.clock.runFor(1);
    await expect(component.getByTestId("no-moves")).toHaveText("false");
  });
}

for (const blockedColor of ["white", "black"] as const) {
  test(`local snapshots keep blocked and following dice separate after moves (${blockedColor})`, async ({ mount, page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let requests = 0;
    await page.route("**/api/dice/roll/**", async route => {
      // GameScreen can request the opening roll before StateSeedProbe installs
      // the mid-game position. Count only the two normal rolls under inspection.
      if (new URL(route.request().url()).searchParams.get("type") === "opening") {
        await route.fulfill({ json: { dice: [2, 4] } });
        return;
      }
      requests += 1;
      await route.fulfill({ json: { dice: requests === 1 ? [2, 4] : [6, 3] } });
    });
    const points = new Array(24).fill(0);
    for (let index = 0; index < 6; index++) {
      points[blockedColor === "white" ? 23 - index : index] = blockedColor === "white" ? -2 : 2;
    }
    const initial: GameState = {
      ...newGame(), points, phase: "rolling", turn: blockedColor,
      bar: { white: blockedColor === "white" ? 1 : 0, black: blockedColor === "black" ? 1 : 0 },
    };
    const render = (state: GameState) => (
      <MemoryRouter><LocalGameProvider botColor="black">
        <StateSeedProbe state={state} />
        <GameProbe from={0} to={0} />
        <GameScreen />
      </LocalGameProvider></MemoryRouter>
    );
    const component = await mount(render(initial));
    if (blockedColor === "white") await component.getByTestId("roll").click();
    else await page.clock.runFor(1500);
    await expect(component.locator('[data-roll-kind="blocked"]')).toHaveAttribute("data-roll-color", blockedColor);
    if (blockedColor === "white") await page.clock.runFor(1500);
    else await component.getByTestId("roll").click();
    await expect.poll(() => requests).toBe(2);
    await expect(component.locator('[data-roll-kind="following"]')).toBeVisible();
    // The presentation must keep the provider's captured roll after the live
    // dice are cleared, without pausing the bot or the human player's turn.
    await component.update(render({ ...initial, turn: "white", dice: [], remaining: [] }));
    const blocked = component.locator('[data-roll-kind="blocked"]');
    const following = component.locator('[data-roll-kind="following"]');
    const blockedSide = blockedColor === "white" ? "right" : "left";
    const followingSide = blockedColor === "white" ? "left" : "right";
    await expect(blocked).toHaveAttribute("data-roll-owner", blockedColor === "white" ? "self" : "opponent");
    await expect(following).toHaveAttribute("data-roll-owner", blockedColor === "white" ? "opponent" : "self");
    await expect(blocked.locator('xpath=ancestor::*[@data-overlay-side][1]')).toHaveAttribute("data-overlay-side", blockedSide);
    await expect(following.locator('xpath=ancestor::*[@data-overlay-side][1]')).toHaveAttribute("data-overlay-side", followingSide);
    // applyRoll orders a normal roll from the higher die to the lower die.
    await expect(blocked.getByTestId("die").nth(0).locator("span")).toHaveCount(4);
    await expect(blocked.getByTestId("die").nth(1).locator("span")).toHaveCount(2);
    await expect(following.getByTestId("die").nth(0).locator("span")).toHaveCount(6);
    await expect(following.getByTestId("die").nth(1).locator("span")).toHaveCount(3);
    await page.clock.runFor(blockedColor === "white" ? 1499 : 2999);
    await expect(blocked).toBeVisible();
    await expect(component.getByTestId("no-moves-overlay").locator('xpath=ancestor::*[@data-overlay-side][1]')).toHaveAttribute("data-overlay-side", blockedSide);
    await expect(component.getByTestId("turn-notice-details").locator('[data-roll-kind="blocked"]')).toBeVisible();
    await expect(component.getByTestId("turn-notice-details").locator('[data-roll-kind="following"]')).toHaveCount(0);
    await expect(following.locator('xpath=ancestor::*[@data-overlay-side][1]')).toHaveAttribute("data-overlay-side", followingSide);
    await page.clock.runFor(1);
    await expect(blocked).toHaveCount(0);
    await expect(following).toHaveCount(0);
  });
}

test("dice service failure shows an error and does not roll", async ({ mount, page }) => {
  await page.route("**/api/dice/roll/**", async (route) => {
    await route.fulfill({ status: 503, json: { error: "Dice service unreachable" } });
  });

  const component = await mount(
    <LocalGameProvider matchTarget={1}>
      <SeedRolling />
      <GameProbe from={0} to={0} />
    </LocalGameProvider>,
  );

  await expect(component.getByTestId("phase")).toHaveText("rolling");
  await component.getByTestId("roll").click();

  await expect(component.getByTestId("error")).toHaveText("Dice service unreachable");
  await expect(component.getByTestId("phase")).toHaveText("rolling");
});

test("local earlier meaningful choice keeps undo after forced final", async ({ mount }) => {
  const points = new Array(24).fill(0);
  points[0] = 2;
  points[1] = 1;
  const state: GameState = {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 12, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [2, 1],
    remaining: [2, 1],
    lastMove: [],
    moveHistory: [],
    message: "",
  };
  const component = await mount(
    <LocalGameProvider matchTarget={5}>
      <StateSeedProbe state={state} />
      <GameProbe
        from={0}
        to={OFF}
        secondMove={{ from: 1, to: OFF }}
      />
      <ForcedAutoConfirmProbe />
    </LocalGameProvider>,
  );
  await component.getByTestId("move").click();
  await component.getByTestId("move-2").click();
  await expect(component.getByTestId("probe-phase")).toHaveText("moving");
  await expect(component.getByTestId("probe-turn")).toHaveText("white");
  await expect(component.getByTestId("probe-remaining")).toHaveText("[]");
  await component.getByTestId("undo").click();
  await expect(component.getByTestId("probe-phase")).toHaveText("moving");
  await expect(component.getByTestId("probe-turn")).toHaveText("white");
  await expect(component.getByTestId("probe-remaining")).toHaveText("[2]");
});

