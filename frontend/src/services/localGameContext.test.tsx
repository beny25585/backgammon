import { test, expect } from "@playwright/experimental-ct-react";
import { LocalGameProvider } from "./localGameContext";
import { ClockProbe, StartMidGame } from "../test-utils/probes";

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
