import { test, expect } from "@playwright/experimental-ct-react";
import AnimatedNumber from "./AnimatedNumber";

test("renders the start value before animating", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <div>
      <AnimatedNumber from={0} to={4} />
    </div>,
  );
  await page.clock.fastForward(1000);
  await expect(component.getByTestId("animated-number")).toHaveText("4");
});

test("uses a custom data-testid when provided", async ({ mount, page }) => {
  await page.clock.install();
  const component = await mount(
    <div>
      <AnimatedNumber from={0} to={4} data-testid="score" />
    </div>,
  );
  await page.clock.fastForward(1000);
  await expect(component.getByTestId("score")).toHaveText("4");
});

test("reaches the target value after the animation", async ({
  mount,
  page,
}) => {
  await page.clock.install();
  const component = await mount(
    <div>
      <AnimatedNumber from={0} to={4} />
    </div>,
  );
  await page.clock.fastForward(1000);
  await expect(component.getByTestId("animated-number")).toHaveText("4");
});
