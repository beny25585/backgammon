import { test, expect } from "@playwright/experimental-ct-react";
import { LocalGameProvider } from "./localGameContext";
import { GameOverProbe, MatchScoreProbe } from "../test-utils/probes";
import { clientLogger } from "./logger";

test("matchScore persists after auto-advance countdown", async ({
  mount,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  const component = await mount(
    <LocalGameProvider matchTarget={7}>
      <GameOverProbe />
      <MatchScoreProbe />
    </LocalGameProvider>,
  );

  await expect(component.getByText("You Win!")).toBeVisible();
  await expect(component.getByTestId("score")).toHaveText(
    '{"white":4,"black":0}',
  );

  await page.clock.fastForward(31000);
  await expect(component.getByText("You Win!")).not.toBeVisible();
  const body = await page.evaluate(() => document.body.innerText);
  clientLogger.debug("BODY:", { body });
  clientLogger.debug("ERRORS:", { errors });
  await expect(component.getByTestId("score")).toHaveText(
    '{"white":4,"black":0}',
  );
});
