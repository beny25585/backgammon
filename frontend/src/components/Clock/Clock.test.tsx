import { test, expect } from "@playwright/experimental-ct-react";
import Clock from "./Clock";

test("renders both players' times", async ({ mount }) => {
  const clock = await mount(
    <Clock
      clock={{ white: 65_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
    />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveText(/1:05/);
  await expect(clock.getByTestId("clock-opp")).toHaveText(/2:00/);
});

test("renders the no-limit dash when clock is null", async ({ mount }) => {
  const clock = await mount(
    <Clock clock={null} activeColor="white" myColor="white" myLabel="You" oppLabel="Bob" />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveText("You--:--");
  await expect(clock.getByTestId("clock-opp")).toHaveText("Bob--:--");
});

test("highlights my side green when I am active", async ({ mount }) => {
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
    />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveClass(/myActive/);
  await expect(clock.getByTestId("clock-opp")).toHaveClass(/idle/);
});

test("highlights the opponent side gold when they are active", async ({ mount }) => {
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="black"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
    />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveClass(/idle/);
  await expect(clock.getByTestId("clock-opp")).toHaveClass(/oppActive/);
});

test("turns my side red when time is low", async ({ mount }) => {
  const clock = await mount(
    <Clock
      clock={{ white: 9_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
    />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveClass(/low/);
  await expect(clock.getByTestId("clock-opp")).not.toHaveClass(/low/);
});

test("shows the delay as seconds (no plus) for the active player", async ({ mount, page }) => {
  await page.clock.install({ time: new Date(5_000) });
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
      delayMs={12_000}
      turnStartedAt={0}
    />,
  );
  await expect(clock.getByTestId("clock-delay")).toHaveText("Delay07");
  await expect(clock.getByTestId("clock-delay")).not.toHaveText("+");
});

test("hides the delay when there is no delay configured", async ({ mount }) => {
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
    />,
  );
  await expect(clock.getByTestId("clock-delay")).not.toBeVisible();
});

test("does not drain the reserve during the delay window", async ({ mount, page }) => {
  await page.clock.install({ time: new Date(5_000) });
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
      delayMs={12_000}
      turnStartedAt={0}
    />,
  );
  await expect(clock.getByTestId("clock-my")).toHaveText(/2:00/);
});

test("drains the reserve only after the delay elapses", async ({ mount, page }) => {
  await page.clock.install({ time: new Date(0) });
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
      delayMs={12_000}
      turnStartedAt={0}
    />,
  );
  await page.clock.fastForward(15_000);
  await expect(clock.getByTestId("clock-my")).toHaveText(/1:57/);
});

test("keeps the idle player's time frozen", async ({ mount, page }) => {
  await page.clock.install({ time: new Date(0) });
  const clock = await mount(
    <Clock
      clock={{ white: 120_000, black: 120_000 }}
      activeColor="white"
      myColor="white"
      myLabel="You"
      oppLabel="Bob"
      delayMs={12_000}
      turnStartedAt={0}
    />,
  );
  await page.clock.fastForward(15_000);
  await expect(clock.getByTestId("clock-opp")).toHaveText(/2:00/);
});
