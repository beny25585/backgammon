import { test, expect } from "@playwright/experimental-ct-react";
import { BoardReactionsHarness, PlayerReactionPickerHarness } from "./PlayerReactions.story";
import PlayerReactionBubble from "./PlayerReactionBubble";
import type { PlayerReaction } from "../../lib/playerReactions";

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("backgammon-game-locale", "en");
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
  });
});

test("keyboard opening puts focus inside the picker and Escape restores its trigger", async ({ mount, page }) => {
  const component = await mount(<PlayerReactionPickerHarness />);
  const trigger = component.getByRole("button", { name: "Send a quick reaction" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Quick reactions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close reactions" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("sending closes the picker and blocks another selection until cooldown ends", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionPickerHarness />);
  const trigger = component.getByRole("button", { name: "Send a quick reaction" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Quick reactions" });
  await dialog.getByRole("button", { name: "Good luck", exact: true }).click();
  await expect(component.getByTestId("sent-reaction")).toHaveText("good_luck");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole("button", { name: "Thanks", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Applause", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Wait a moment before sending again");
  await page.clock.runFor(3001);
  await expect(dialog.getByRole("button", { name: "Thanks", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Applause", exact: true })).toBeEnabled();
});

test("muting stays available during cooldown and announces its pressed state", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
  const component = await mount(<PlayerReactionPickerHarness />);
  await component.getByRole("button", { name: "Send a quick reaction" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick reactions" });
  await dialog.getByRole("button", { name: "Thanks", exact: true }).click();
  await component.getByRole("button", { name: "Send a quick reaction" }).click();
  await expect(dialog.getByRole("button", { name: "Thanks", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Mute opponent reactions", exact: true }).click();
  const unmute = dialog.getByRole("button", { name: "Unmute opponent reactions", exact: true });
  await expect(unmute).toHaveAttribute("aria-pressed", "true");
  await unmute.click();
  await expect(dialog.getByRole("button", { name: "Mute opponent reactions", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("Hebrew labels and direction are applied to the complete picker", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("backgammon-game-locale", "he"));
  const component = await mount(<PlayerReactionPickerHarness />);
  await component.getByRole("button", { name: "שליחת תגובה מהירה" }).click();
  const dialog = page.getByRole("dialog", { name: "תגובות מהירות" });
  await expect(dialog).toHaveAttribute("dir", "rtl");
  await expect(dialog.getByRole("button", { name: "בהצלחה", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "מחיאות כפיים", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "השתקת תגובות היריב", exact: true })).toBeVisible();
});

test("losing availability closes an open picker and disables sending", async ({ mount, page }) => {
  const component = await mount(<PlayerReactionPickerHarness />);
  await component.getByRole("button", { name: "Send a quick reaction" }).click();
  await expect(page.getByRole("dialog", { name: "Quick reactions" })).toBeVisible();
  await component.update(<PlayerReactionPickerHarness enabled={false} />);
  await expect(page.getByRole("dialog", { name: "Quick reactions" })).not.toBeVisible();
  await expect(component.getByRole("button", { name: "Send a quick reaction" })).toBeDisabled();
});

test("a failed send keeps the picker open with its error and permits retry", async ({ mount, page }) => {
  const component = await mount(<PlayerReactionPickerHarness sendSucceeds={false} />);
  await component.getByRole("button", { name: "Send a quick reaction" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick reactions" });
  await dialog.getByRole("button", { name: "Thanks", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Reactions are temporarily unavailable");
  await expect(component.getByTestId("sent-reaction")).toHaveText("none");
  await expect(dialog.getByRole("button", { name: "Thanks", exact: true })).toBeEnabled();
});

test("a delayed server error exposes a retry trigger without changing its height", async ({ mount, page }) => {
  const component = await mount(<PlayerReactionPickerHarness />);
  const trigger = component.getByRole("button", { name: "Send a quick reaction" });
  const initialBox = await trigger.boundingBox();
  await trigger.click();
  await page.getByRole("dialog", { name: "Quick reactions" }).getByRole("button", { name: "Thanks", exact: true }).click();
  await component.update(<PlayerReactionPickerHarness serverError="unavailable" />);
  const retry = component.getByRole("button", { name: "Try sending a reaction again" });
  await expect(retry).toHaveText("Try again");
  await expect(component.getByRole("status").filter({ hasText: "Reactions are temporarily unavailable" })).toHaveText("Reactions are temporarily unavailable");
  expect((await retry.boundingBox())?.height).toBe(initialBox?.height);
  await retry.click();
  await expect(page.getByRole("dialog", { name: "Quick reactions" })).toBeVisible();
});

test("bubble arrival and removal preserve its slot height and surrounding content position", async ({ mount }) => {
  const reaction: PlayerReaction = {
    id: "bubble-1", roomId: "room-a", color: "black", reactionId: "nice_move", expiresAt: Date.now() + 4000,
  };
  const component = await mount(<div><PlayerReactionBubble /><p data-testid="following-content">Score and clock</p></div>);
  const slot = component.getByTestId("player-reaction-slot");
  const content = component.getByTestId("following-content");
  const initialSlot = await slot.boundingBox();
  const initialContent = await content.boundingBox();
  expect(initialSlot?.height).toBeGreaterThan(0);

  await component.update(<div><PlayerReactionBubble reaction={reaction} /><p data-testid="following-content">Score and clock</p></div>);
  await expect(component.getByTestId("player-reaction-black")).toHaveText("Nice move");
  expect((await slot.boundingBox())?.height).toBe(initialSlot?.height);
  expect((await content.boundingBox())?.y).toBe(initialContent?.y);
  await component.update(<div><PlayerReactionBubble /><p data-testid="following-content">Score and clock</p></div>);
  await expect(component.getByTestId("player-reaction-black")).toHaveCount(0);
  expect((await slot.boundingBox())?.height).toBe(initialSlot?.height);
  expect((await content.boundingBox())?.y).toBe(initialContent?.y);
});

test("a reduced-motion bubble uses a stable vertical position and accessible emoji label", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount(<PlayerReactionBubble reaction={{
    id: "bubble-emoji", roomId: "room-a", color: "white", reactionId: "clap", expiresAt: Date.now() + 4000,
  }} />);
  const bubble = component.getByTestId("player-reaction-white");
  await expect(bubble).toHaveText("👏");
  await expect(component.getByRole("status")).toHaveText("Applause");
  const slotBox = await component.boundingBox();
  const bubbleBox = await bubble.boundingBox();
  expect(bubbleBox?.y).toBe(slotBox?.y);
});

for (const rotated of [false, true]) {
  test(`board reactions stay inside their sender's half and clear gameplay (${rotated ? "rotated" : "landscape"})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    const component = await mount(<BoardReactionsHarness rotated={rotated} />);
    await expect(component.getByTestId("player-reaction-white")).toBeVisible();
    await expect(component.getByTestId("player-reaction-black")).toBeVisible();
    const obstacles = await component.locator('[data-checker], [data-testid="dice-overlay"], button').all();

    for (const [color, side] of [["white", "right"], ["black", "left"]] as const) {
      const bubble = await component.locator(`[data-board-reaction="${color}"]`).boundingBox();
      const half = await component.getByTestId(`board-half-${side}`).boundingBox();
      expect(bubble).not.toBeNull();
      expect(half).not.toBeNull();
      expect(bubble!.x).toBeGreaterThanOrEqual(half!.x);
      expect(bubble!.y).toBeGreaterThanOrEqual(half!.y);
      expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(half!.x + half!.width);
      expect(bubble!.y + bubble!.height).toBeLessThanOrEqual(half!.y + half!.height);

      for (const obstacle of obstacles) {
        const occupied = await obstacle.boundingBox();
        expect(occupied).not.toBeNull();
        const intersects = bubble!.x < occupied!.x + occupied!.width && bubble!.x + bubble!.width > occupied!.x
          && bubble!.y < occupied!.y + occupied!.height && bubble!.y + bubble!.height > occupied!.y;
        expect(intersects).toBe(false);
      }
    }
  });
}

test("board reactions yield to newly occupied space and return only when space is free", async ({ mount, page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const component = await mount(<BoardReactionsHarness />);
  await expect(component.getByTestId("player-reaction-white")).toBeVisible();
  await expect(component.getByTestId("player-reaction-black")).toBeVisible();
  await component.update(<BoardReactionsHarness crowded />);
  await expect(component.getByTestId("player-reaction-white")).not.toBeVisible();
  await expect(component.getByTestId("player-reaction-black")).not.toBeVisible();
  await component.update(<BoardReactionsHarness />);
  await expect(component.getByTestId("player-reaction-white")).toBeVisible();
  await expect(component.getByTestId("player-reaction-black")).toBeVisible();
});
