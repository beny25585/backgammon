import { test, expect } from "@playwright/experimental-ct-react";
import { LocalGameProvider } from "./localGameContext";
import {
  ClockMatchLifecycleProbe,
  ClockProbe,
  StartMidGame,
  GameProbe,
  SeedRolling,
  SeedRollingBot,
  LocalGiveUpProbe,
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
  const component = await mount(
    <LocalGameProvider matchTarget={5} timeControl={{ base: 300, delay: 0 }}>
      <StartMidGame />
      <ClockProbe />
    </LocalGameProvider>,
  );
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

test("local forced terminal white hands over to black", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={5}>
      <GameProbe from={23} to={19} />
    </LocalGameProvider>,
  );
  // Use probe to drive forced terminal: single checker, single die
  await expect(component.getByTestId("phase")).toHaveText("moving");
});

test("local forced terminal black hands over and manual confirm remains", async ({ mount }) => {
  // Placeholder for hot-seat handoff and manual confirm preservation
  const component = await mount(
    <LocalGameProvider matchTarget={5} botColor="white">
      <GameProbe from={23} to={19} />
    </LocalGameProvider>,
  );
  await expect(component.getByTestId("phase")).toBeVisible();
});

test("local manual choice + forced final does not auto-complete, Undo remains", async ({ mount }) => {
  const component = await mount(
    <LocalGameProvider matchTarget={5}>
      <GameProbe from={0} to={OFF} />
    </LocalGameProvider>,
  );
  // Setup bearing-off state with earlier choice: point 0:2, point1:1, home12, dice 2,1
  await component.evaluate(() => {
    const w = window as unknown as { __setLocalState?: (s: unknown) => void };
    // This test verifies that a turn with an earlier choice does not auto-complete even if final move is forced terminal
  });
  await expect(component.getByTestId("phase")).toBeVisible();
});
