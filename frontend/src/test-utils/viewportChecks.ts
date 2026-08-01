import { expect } from "@playwright/experimental-ct-react";
import type { Locator } from "@playwright/test";

export async function assertNoHorizontalOverflow(locator: Locator): Promise<void> {
  const result = await locator.evaluate((el) => {
    const { scrollWidth, clientWidth } = el;
    return { scrollWidth, clientWidth };
  });
  expect(result.scrollWidth, "element should not overflow horizontally").toBeLessThanOrEqual(
    result.clientWidth + 1,
  );
}

export async function assertFillsParent(locator: Locator): Promise<void> {
  const result = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (!parent) return { width: rect.width, parentWidth: null };
    return { width: rect.width, parentWidth: parent.getBoundingClientRect().width };
  });
  expect(result.parentWidth, "element should have a parent").not.toBeNull();
  expect(
    Math.abs(result.width - (result.parentWidth ?? 0)),
    "element should fill its parent width",
  ).toBeLessThan(1);
}
