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
    whiteScore={1} blackScore={0} onClose={() => {}} onRematch={() => {}} />,
    { hooksConfig: { locale: "en" } });
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(300_000);
  expect(calls).toBe(1);
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(0);
  await expect(component.getByRole("status").filter({ hasText: "Analysis is currently unavailable." })).toBeVisible();
});

test("temporary analysis failures back off instead of polling every five seconds", async ({ mount, page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/tournaments-api/analyses?room=offline", route => {
    calls++;
    return route.fulfill({ status: 503, json: { retryable: true } });
  });
  const component = await mount(<QuickGameResult roomId="offline" winner="white"
    whiteScore={1} blackScore={0} onClose={() => {}} onRematch={() => {}} />,
    { hooksConfig: { locale: "en" } });
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(15_000);
  expect(calls).toBe(1);
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(6);
  await page.clock.runFor(25_000);
  await expect.poll(() => calls).toBe(2);
  await page.clock.runFor(70_000);
  await expect.poll(() => calls).toBe(3);
  await page.clock.runFor(300_000);
  expect(calls).toBe(3);
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(0);
  await expect(component.getByRole("status").filter({ hasText: "Analysis is currently unavailable." })).toBeVisible();
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
              { color: "white", game_rating: 1300, pr: "8.5", luck: "-0.12" },
              { color: "black", game_rating: 1600, pr: "2.1", luck: "0.12" },
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
    { hooksConfig: { locale: "en" } },
  );
  await expect(component.getByTestId("score-left")).toHaveText("1");
  await expect(component.getByText("2.10", { exact: true })).toBeVisible();
  const row = component.getByText("PR", { exact: true }).locator("..");
  await expect(row.locator("span").first()).toHaveText("2.10");
  await expect(row.locator("span").last()).toHaveText("8.50");
  const ratingRow = component.getByText("Game Rating", { exact: true }).locator("..");
  await expect(ratingRow.locator("span").first()).toHaveText("1600");
  await expect(ratingRow.locator("span").last()).toHaveText("1300");
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
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let completed = false;
  let calls = 0;
  let releaseResponse!: () => void;
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/tournaments-api/analyses?room=pending", async (route) => {
    await responseReady;
    calls++;
    return route.fulfill({
      json: {
        matches: [
          {
            id: "pending-id",
            room_id: "pending",
            created_at: "2026-09-19",
            status: completed ? "completed" : "processing",
            players: [{ color: "white", game_rating: 1400, pr: 9.75, luck: 0.125 }],
          },
        ],
      },
    });
  });
  const component = await mount(
    <QuickGameResult
      roomId="pending"
      winner="white"
      whiteScore={1}
      blackScore={0}
      ratingAfter={1500}
      coinsDelta={0}
      durationSeconds={125}
      onClose={() => {}}
      onRematch={() => {}}
    />,
    { hooksConfig: { locale: "en" } },
  );
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(6);
  await expect(component.getByTestId("result-metric-loading").first()).toBeVisible();
  expect(await component.getByTestId("result-metric-loading").first().evaluate(
    (element) => getComputedStyle(element).animationName,
  )).toBe("none");
  releaseResponse();
  await expect.poll(() => calls).toBe(1);
  await expect(
    component.getByRole("status").filter({ hasText: "Analysis in progress —" }),
  ).toBeVisible();
  const prRow = component.getByText("PR", { exact: true }).locator("..");
  const ratingRow = component.getByText("Game Rating", { exact: true }).locator("..");
  await expect(component.getByRole("link", { name: "Full analysis" })).toHaveAttribute(
    "href",
    /\/analysis\/pending-id\?room=pending$/,
  );
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(6);
  await expect(prRow).toHaveAttribute("aria-busy", "true");
  await expect(ratingRow).toHaveAttribute("aria-busy", "true");
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByText("1500", { exact: true })).toBeVisible();
  await expect(component.getByText("Coins").locator("..").locator("span").first()).toHaveText("0");
  await expect(component.getByText("02:05", { exact: true })).toBeVisible();
  await expect(component.getByText("9.75", { exact: true })).toHaveCount(0);
  await expect(component.getByText("0.125", { exact: true })).toHaveCount(0);

  completed = true;
  await page.clock.runFor(5000);
  await expect(prRow.locator("span").first()).toHaveText("9.75");
  await expect(ratingRow.locator("span").first()).toHaveText("1400");
  await expect(component.getByText("0.125", { exact: true })).toBeVisible();
  await expect(component.getByText("Analysis in progress —")).toHaveCount(0);
  await expect(component.getByTestId("result-metric-loading")).toHaveCount(0);
  await expect(prRow).toHaveAttribute("aria-busy", "false");
  await expect(ratingRow.locator("span").last()).toHaveText("—");
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
    { hooksConfig: { locale: "en" } },
  );
  const card = component.getByTestId("game-result-card");
  await expect(component.getByText("PR", { exact: true })).toBeVisible();
  await expect(component.getByText("1.20", { exact: true })).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});
