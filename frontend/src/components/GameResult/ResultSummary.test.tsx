import { test, expect } from "@playwright/experimental-ct-react";
import QuickGameResult from "./QuickGameResult";

test("result maps analysis to black self, preserves zero coins, and links to this analysis", async ({ mount, page }) => {
  await page.route("**/tournaments-api/analyses?room=room-1", route => route.fulfill({ json: { matches: [{
    id: "analysis-1", room_id: "room-1", created_at: "2026-09-19", status: "completed",
    players: [{ color: "white", pr: "8.5", luck: "-0.12" }, { color: "black", pr: "2.1", luck: "0.12" }],
  }] } }));
  const component = await mount(<QuickGameResult roomId="room-1" playerColor="black" winner="white"
    whiteScore={3} blackScore={1} whiteName="Alice" blackName="Bob" cube={1}
    ratingAfter={1500} coinsDelta={0} durationSeconds={125} onClose={() => {}} onRematch={() => {}} />);
  await expect(component.getByTestId("score-left")).toHaveText("1");
  await expect(component.getByText("2.10", { exact: true })).toBeVisible();
  const row = component.getByText("Game rating (PR)").locator("..");
  await expect(row.locator("span").first()).toHaveText("2.10");
  await expect(component.getByText("1500", { exact: true })).toBeVisible();
  await expect(component.getByText("02:05", { exact: true })).toBeVisible();
  await expect(component.getByText("Coins").locator("..").locator("span").first()).toHaveText("0");
  await expect(component.getByRole("link", { name: "Full analysis" })).toHaveAttribute("href", /\/tournaments\/analysis\/analysis-1\?room=room-1$/);
});

test("pending analysis hides partial metrics until completed", async ({ mount, page }) => {
  await page.route("**/tournaments-api/analyses?room=pending", route => route.fulfill({ json: { matches: [{
    id: "pending-id", room_id: "pending", created_at: "2026-09-19", status: "processing",
    players: [{ color: "white", pr: 0, luck: 0 }],
  }] } }));
  const component = await mount(<QuickGameResult roomId="pending" winner="white" whiteScore={1} blackScore={0}
    cube={1} onClose={() => {}} onRematch={() => {}} />);
  await expect(component.getByRole("status")).toContainText("Analysis in progress");
  await expect(component.getByText("Game rating (PR)").locator("..").locator("span").first()).toHaveText("—");
});
