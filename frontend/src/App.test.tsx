import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "./i18n/I18nProvider";
import App from "./App";

test("game stays visible and horizontal without a rotation prompt", async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(
    <MemoryRouter initialEntries={["/local"]}><I18nProvider><App /></I18nProvider></MemoryRouter>,
  );
  await expect(component.getByTestId("rotate-prompt")).toHaveCount(0);
  await expect(component.getByTestId("board-frame")).toBeVisible();
  const viewport = component.locator('[data-game-viewport="true"]');
  await expect(viewport).toHaveCSS("width", "844px");
  await expect(viewport).toHaveCSS("height", "390px");
  const bounds = await viewport.boundingBox();
  expect(bounds?.width).toBeCloseTo(390);
  expect(bounds?.height).toBeCloseTo(844);
  expect(bounds?.x).toBeCloseTo(0);
  expect(bounds?.y).toBeCloseTo(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(viewport).toHaveCSS("transform", "none");
  await expect(component.getByTestId("board-frame")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(component.getByTestId("rotate-prompt")).toHaveCount(0);
  await expect(component.getByTestId("board-frame")).toBeVisible();
  await page.screenshot({ path: "test-results/portrait-horizontal-game.png" });
});
