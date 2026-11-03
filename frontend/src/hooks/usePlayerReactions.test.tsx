import { test, expect } from "@playwright/experimental-ct-react";
import { PlayerReactionsHarness } from "./usePlayerReactions.story";

function reaction(overrides: Record<string, unknown> = {}) {
  return {
    type: "player_reaction",
    payload: {
      id: "event-1", roomId: "room-a", color: "black", reactionId: "smile",
      // Deliberate server clock skew: lifetime comes from remainingMs.
      expiresAt: 1, remainingMs: 4000, cooldownMs: 3000, ...overrides,
    },
  };
}

test("same-batch sends lock immediately and a bubble waits for the server echo", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionsHarness message={reaction({ color: "white", reactionId: "thanks" })} />);
  await component.getByRole("button", { name: "send twice", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("1");
  await expect(component.getByTestId("reactions")).toHaveText("{}");
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await expect(component.getByTestId("reactions")).toContainText('"reactionId":"thanks"');
  await page.clock.runFor(3001);
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("2");
});

test("a duplicated event does not prolong its four-second lifetime despite server clock skew", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionsHarness message={reaction()} />);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await expect(component.getByTestId("reactions")).toContainText('"black"');
  await page.clock.runFor(3000);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await page.clock.runFor(1001);
  await expect(component.getByTestId("reactions")).toHaveText("{}");
});

test("replacing a player's bubble keeps the replacement alive when the previous deadline passes", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionsHarness message={reaction()} />);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await page.clock.runFor(3000);
  await component.update(<PlayerReactionsHarness message={reaction({ id: "event-2", reactionId: "clap" })} />);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await page.clock.runFor(1001);
  await expect(component.getByTestId("reactions")).toContainText('"reactionId":"clap"');
  await page.clock.runFor(3000);
  await expect(component.getByTestId("reactions")).toHaveText("{}");
});

for (const invalid of [
  { roomId: "room-b" }, { reactionId: "<script>" }, { remainingMs: 0 },
  { remainingMs: 4001 }, { color: "spectator" }, { id: "" }, { expiresAt: null },
]) {
  test(`ignores an invalid or stale event ${JSON.stringify(invalid)}`, async ({ mount }) => {
    const component = await mount(<PlayerReactionsHarness message={reaction(invalid)} />);
    await component.getByRole("button", { name: "receive", exact: true }).click();
    await expect(component.getByTestId("reactions")).toHaveText("{}");
  });
}

test("room switches clear state and make the prior room's callback inert", async ({ mount }) => {
  const component = await mount(<PlayerReactionsHarness message={reaction()} />);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await component.getByRole("button", { name: "save receiver", exact: true }).click();
  await component.update(<PlayerReactionsHarness roomId="room-b" message={reaction()} />);
  await expect(component.getByTestId("reactions")).toHaveText("{}");
  await component.getByRole("button", { name: "old receiver", exact: true }).click();
  await expect(component.getByTestId("reactions")).toHaveText("{}");
  await component.update(<PlayerReactionsHarness message={reaction()} />);
  await expect(component.getByTestId("reactions")).toHaveText("{}");
});

for (const changed of [{ playerColor: "black" as const }, { enabled: false }]) {
  test(`changing scope or availability clears reactions ${JSON.stringify(changed)}`, async ({ mount }) => {
    const component = await mount(<PlayerReactionsHarness message={reaction()} />);
    await component.getByRole("button", { name: "receive", exact: true }).click();
    await component.update(<PlayerReactionsHarness message={reaction()} {...changed} />);
    await expect(component.getByTestId("reactions")).toHaveText("{}");
  });
}

test("server cooldown errors stay local to reactions and expire before retry", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionsHarness errorMessage={{
    type: "player_reaction_error", payload: { roomId: "room-a", reason: "cooldown", retryAfterMs: 1500 },
  }} />);
  await component.getByRole("button", { name: "receive error", exact: true }).click();
  await expect(component.getByTestId("error")).toHaveText("cooldown");
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("0");
  await page.clock.runFor(1501);
  await expect(component.getByTestId("error")).toHaveText("none");
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("1");
});

test("a disconnected or failed socket never creates a bubble or leaves a send lock", async ({ mount }) => {
  const component = await mount(<PlayerReactionsHarness connected={false} />);
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("0");
  await expect(component.getByTestId("error")).toHaveText("unavailable");
  await component.update(<PlayerReactionsHarness sendSucceeds={false} />);
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("cooldown")).toHaveText("0");
  await expect(component.getByTestId("reactions")).toHaveText("{}");
  await component.update(<PlayerReactionsHarness />);
  await component.getByRole("button", { name: "send", exact: true }).click();
  await expect(component.getByTestId("sent")).toHaveText("2");
});

test("reset clears visible reactions and does not replay them", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionsHarness message={reaction()} />);
  await component.getByRole("button", { name: "receive", exact: true }).click();
  await component.getByRole("button", { name: "reset", exact: true }).click();
  await page.clock.runFor(5000);
  await expect(component.getByTestId("reactions")).toHaveText("{}");
  await expect(component.getByTestId("error")).toHaveText("none");
});
