import { test, expect } from "@playwright/experimental-ct-react";
import SamsungDarkModeHelp from "./SamsungDarkModeHelp";

const SAMSUNG_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 " +
  "Chrome/130.0 Mobile Safari/537.36 SamsungBrowser/27.0";

test("stays hidden outside Samsung Internet", async ({ mount }) => {
  const component = await mount(<SamsungDarkModeHelp />);

  await expect(component.getByRole("button", { name: "Game looks dark?" })).toHaveCount(0);
});

test("offers display help, Chrome, and app installation in Samsung Internet", async ({
  mount,
  page,
}) => {
  await mount(
    <SamsungDarkModeHelp userAgent={SAMSUNG_USER_AGENT} />,
  );

  await page.getByRole("button", { name: "Game looks dark?" }).click();
  const dialog = page.getByRole("dialog", { name: "Samsung Internet changed the colors" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Settings → Dark mode");
  await expect(dialog.getByTestId("open-in-chrome")).toHaveAttribute(
    "href",
    /package=com\.android\.chrome/,
  );
  await expect(dialog.getByRole("button", { name: "Install app" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-samsung-internet", "true");
});
