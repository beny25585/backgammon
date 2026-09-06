import { test, expect } from "@playwright/experimental-ct-react";
import { DiceRow, RollPrompt } from "./Dice";

test("starts spinning on click, then fires onRoll after a short delay", async ({ mount }) => {
  let rolled = 0;
  const rp = await mount(<RollPrompt onRoll={() => rolled++} />);
  await expect(rp).toHaveAttribute("data-testid", "roll-prompt-btn");
  await rp.click();
  await expect(rp.getByTestId("rolling-die")).toHaveCount(2);
  await expect.poll(() => rolled).toBe(1);
});

test("keeps spinning until landOn arrives, then completes", async ({ mount, page }) => {
  let done = 0;
  const rp = await mount(<RollPrompt onRoll={() => {}} onLand={() => done++} />);
  await rp.click();
  await page.waitForTimeout(300);
  expect(done).toBe(0); // still spinning — roll not fired yet
  await rp.update(<RollPrompt onRoll={() => {}} onLand={() => done++} landOn={[3, 5]} />);
  await expect.poll(() => done).toBeGreaterThanOrEqual(1);
});

test("clicking playable dice row requests dice reorder", async ({ mount }) => {
  let reorderCalls = 0;
  const row = await mount(
    <DiceRow
      dice={[5, 2]}
      remaining={[5, 2]}
      color="white"
      onReorder={() => reorderCalls++}
    />,
  );

  await row.click();

  expect(reorderCalls).toBe(1);
});
