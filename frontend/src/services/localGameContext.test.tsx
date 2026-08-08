import { test, expect } from "@playwright/experimental-ct-react";
import { LocalGameProvider } from "./localGameContext";
import { ClockProbe, StartMidGame, GameProbe, SeedRolling, SeedRollingBot } from "../test-utils/probes";

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

test("human times out and the bot wins", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <LocalGameProvider matchTarget={1} timeControl={{ base: 300, delay: 0 }}>
      <StartMidGame />
    </LocalGameProvider>,
  );
  await page.clock.fastForward(2000);
  await expect(component.getByText("Match Lost")).toBeVisible();
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
  await expect(component.getByTestId("dice")).toHaveText("[2,5]");
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
