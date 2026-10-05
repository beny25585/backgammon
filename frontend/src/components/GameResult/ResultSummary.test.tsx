import { test, expect } from "@playwright/experimental-ct-react";
import QuickGameResult from "./QuickGameResult";

test("unconfigured analysis stops polling while the result remains visible", async ({ mount, page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/tournaments-api/analyses?room=disabled", route => {
    calls++;
    return route.fulfill({ status: 503, json: { code: "analysis_not_configured", retryable: false } });
  });
  const component = await mount(<QuickGameResult roomId="disabled" winner="white"
    whiteScore={1} blackScore={0} onClose={() => {}} onRematch={() => {}} />);
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(300_000);
  expect(calls).toBe(1);
  await expect(component.getByTestId("score-left")).toBeVisible();
});

test("temporary analysis failures back off instead of polling every five seconds", async ({ mount, page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/tournaments-api/analyses?room=offline", route => {
    calls++;
    return route.fulfill({ status: 503, json: { retryable: true } });
  });
  await mount(<QuickGameResult roomId="offline" winner="white"
    whiteScore={1} blackScore={0} onClose={() => {}} onRematch={() => {}} />);
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(15_000);
  expect(calls).toBe(1);
  await page.clock.runFor(25_000);
  await expect.poll(() => calls).toBe(2);
  await page.clock.runFor(70_000);
  await expect.poll(() => calls).toBe(3);
  await page.clock.runFor(300_000);
  expect(calls).toBe(3);
});

test("result maps analysis to black self, preserves zero coins, and links to this analysis", async ({
  mount,
  page,
}) => {
  await page.route("**/tournaments-api/analyses?room=room-1", (route) =>
    route.fulfill({
      json: {
        matches: [
          {
            id: "analysis-1",
            room_id: "room-1",
            created_at: "2026-09-19",
            status: "completed",
            players: [
              { color: "white", pr: "8.5", luck: "-0.12" },
              { color: "black", pr: "2.1", luck: "0.12" },
            ],
          },
        ],
      },
    }),
  );
  const component = await mount(
    <QuickGameResult
      roomId="room-1"
      playerColor="black"
      winner="white"
      whiteScore={3}
      blackScore={1}
      whiteName="Alice"
      blackName="Bob"
      ratingAfter={1500}
      coinsDelta={0}
      durationSeconds={125}
      onClose={() => {}}
      onRematch={() => {}}
    />,
  );
  await expect(component.getByTestId("score-left")).toHaveText("1");
  await expect(component.getByText("2.10", { exact: true })).toBeVisible();
  const row = component.getByText("Game rating (PR)").locator("..");
  await expect(row.locator("span").first()).toHaveText("2.10");
  await expect(component.getByText("1500", { exact: true })).toBeVisible();
  await expect(component.getByText("02:05", { exact: true })).toBeVisible();
  await expect(
    component.getByText("Coins").locator("..").locator("span").first(),
  ).toHaveText("0");
  await expect(
    component.getByRole("link", { name: "Full analysis" }),
  ).toHaveAttribute(
    "href",
    /\/tournaments\/analysis\/analysis-1\?room=room-1$/,
  );
});

test("pending analysis hides partial metrics until completed", async ({
  mount,
  page,
}) => {
  await page.route("**/tournaments-api/analyses?room=pending", (route) =>
    route.fulfill({
      json: {
        matches: [
          {
            id: "pending-id",
            room_id: "pending",
            created_at: "2026-09-19",
            status: "processing",
            players: [{ color: "white", pr: 0, luck: 0 }],
          },
        ],
      },
    }),
  );
  const component = await mount(
    <QuickGameResult
      roomId="pending"
      winner="white"
      whiteScore={1}
      blackScore={0}
      onClose={() => {}}
      onRematch={() => {}}
    />,
  );
  await expect(
    component.getByRole("status").filter({ hasText: "Loading game results" }),
  ).toBeVisible();
  await expect(component.getByText("Game rating (PR)")).toHaveCount(0);
  await expect(component.getByText("Analysis in progress —")).toBeVisible();
});

test("result card fits a narrow phone viewport", async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.route("**/tournaments-api/analyses?room=mobile", (route) =>
    route.fulfill({
      json: {
        matches: [
          {
            id: "mobile-analysis",
            room_id: "mobile",
            created_at: "2026-09-19",
            status: "completed",
            players: [
              { color: "white", pr: 1.2, luck: 0.1 },
              { color: "black", pr: 2.3, luck: -0.1 },
            ],
          },
        ],
      },
    }),
  );
  const component = await mount(
    <QuickGameResult
      roomId="mobile"
      winner="white"
      whiteScore={5}
      blackScore={3}
      whiteName="Alexandria"
      blackName="Maximilian"
      onClose={() => {}}
      onRematch={() => {}}
    />,
  );
  const card = component.getByTestId("game-result-card");
  await expect(component.getByText("Game rating (PR)")).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});
