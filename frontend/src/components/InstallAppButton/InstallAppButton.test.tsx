import { expect, test } from "@playwright/experimental-ct-react";
import InstallAppButton from "./InstallAppButton";

test("shows browser-specific installation help when no native prompt is available", async ({
  mount,
  page,
}) => {
  await mount(<InstallAppButton />);

  await page.getByRole("button", { name: "Install app" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Install 6B as an app" })).toBeVisible();
  await page.getByRole("button", { name: "Close installation instructions" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("uses the browser's native installation prompt when it is available", async ({
  mount,
  page,
}) => {
  await mount(<InstallAppButton />);
  await expect(page.getByRole("button", { name: "Install app" })).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => {
          document.body.dataset.installPromptCalled = "true";
        },
      },
      userChoice: {
        value: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      },
    });
    window.dispatchEvent(event);
  });

  await page.getByRole("button", { name: "Install app" }).click();

  await expect(page.locator("body")).toHaveAttribute(
    "data-install-prompt-called",
    "true",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
