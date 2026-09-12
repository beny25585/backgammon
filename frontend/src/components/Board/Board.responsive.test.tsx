import { test, expect } from "@playwright/experimental-ct-react";
import { Board } from "../Board";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame } from "@/lib/backgammon/engine";
import styles from "../GameScreen/GameScreen.module.css";
import { assertNoHorizontalOverflow } from "../../test-utils/viewportChecks";
import type { GameState } from "@/lib/backgammon/engine";

const VIEWPORTS = [
  { name: "mobile-portrait", width: 375, height: 812 },
  { name: "mobile-landscape", width: 844, height: 390 },
  { name: "mobile-landscape-browser-bars", width: 915, height: 350 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1280, height: 800 },
];

const MIN_CHECKER_PX = 16;
const MIN_POINT_W_PX = 12;
const MIN_BAR_W_PX = 16;
const MIN_BEAROFF_W_PX = 16;

function busyState(): GameState {
  const points = new Array(24).fill(0);
  points[23] = 5;
  points[0] = -5;
  points[12] = 2;
  points[11] = -3;
  return {
    ...newGame(),
    points,
    bar: { white: 2, black: 2 },
    home: { white: 4, black: 4 },
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
  };
}

async function mountBoard(mount: any, state: GameState) {
  return mount(
    <div className={styles.container}>
      <MockGameWrapper playerColor="white" state={state}>
        <Board
          state={state}
          myColor="white"
          selected={null}
          legalTargets={[]}
          legalFromPoints={[]}
          onSelect={() => {}}
          onMove={() => {}}
        />
      </MockGameWrapper>
    </div>,
  );
}

for (const vp of VIEWPORTS) {
  test(`all 24 points render and fit (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const component = await mountBoard(mount, busyState());

    const points = component.locator("[data-point-idx]");
    await expect(points).toHaveCount(26); // 24 points + bar + off

    const pointCells = component.locator('[data-point-idx]:not([data-point-idx="bar"]):not([data-point-idx="off"])');
    await expect(pointCells).toHaveCount(24);
    await expect(pointCells.first()).toBeVisible();

    const minW = await pointCells
      .evaluateAll((els: HTMLElement[]) =>
        Math.min(...els.map((el: HTMLElement) => el.getBoundingClientRect().width)),
      );
    expect(
      minW,
      `narrowest point should be >= ${MIN_POINT_W_PX}px (${vp.name}, got ${minW.toFixed(1)})`,
    ).toBeGreaterThanOrEqual(MIN_POINT_W_PX);
  });

  test(`bar and bear-off are visible with usable width (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const component = await mountBoard(mount, busyState());

    const bar = component.locator('[data-point-idx="bar"]');
    const off = component.locator('[data-point-idx="off"]');
    await expect(bar).toBeVisible();
    await expect(off).toBeVisible();

    const barW = (await bar.evaluate((el: HTMLElement) => el.getBoundingClientRect().width));
    const offW = (await off.evaluate((el: HTMLElement) => el.getBoundingClientRect().width));
    expect(barW, `bar width should be >= ${MIN_BAR_W_PX}px (${vp.name}, got ${barW.toFixed(1)})`).toBeGreaterThanOrEqual(MIN_BAR_W_PX);
    expect(offW, `bear-off width should be >= ${MIN_BEAROFF_W_PX}px (${vp.name}, got ${offW.toFixed(1)})`).toBeGreaterThanOrEqual(MIN_BEAROFF_W_PX);
  });

  test(`checkers in points/bar are not too small (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const component = await mountBoard(mount, busyState());

    await expect(component.locator("[data-checker]").nth(4)).toBeAttached();
    const checkerCount = await component.locator("[data-checker]").count();
    expect(checkerCount, `should render checkers (${vp.name})`).toBeGreaterThanOrEqual(5);

    const checkerPx = await component
      .locator("[data-checker]")
      .first()
      .evaluate((el: HTMLElement) => getComputedStyle(el).width);
    expect(
      parseFloat(checkerPx),
      `checker size should be >= ${MIN_CHECKER_PX}px (${vp.name}, got ${checkerPx})`,
    ).toBeGreaterThanOrEqual(MIN_CHECKER_PX);
  });

  test(`board wrapper has no horizontal overflow (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const component = await mountBoard(mount, busyState());

    await assertNoHorizontalOverflow(page.locator("body"));
    await assertNoHorizontalOverflow(component.locator('[class*="wrapper"]'));
  });

  test(`five-checker stacks fit inside their points (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const component = await mountBoard(mount, busyState());
    for (const index of [23, 0]) {
      const point = component.locator(`[data-point-idx="${index}"]`);
      await expect(point.locator("[data-checker]")).toHaveCount(5);
      const fits = await point.evaluate((element: HTMLElement) => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll("[data-checker]")].every((checker) => {
          const rect = checker.getBoundingClientRect();
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom
            && Math.abs(rect.width - rect.height) < 1;
        });
      });
      expect(fits, `all five checkers on point ${index} must be fully visible`).toBe(true);
    }
  });
}

test("short landscape keeps bar checkers clear of the larger pip counts", async ({ mount, page }) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  const component = await mountBoard(mount, busyState());

  const bar = component.locator('[data-point-idx="bar"]');
  const whitePip = component.getByTestId("bar-pip-white");
  const whiteChecker = component.getByTestId("bar-checkers-white").locator("[data-checker]").first();
  const barBox = await bar.boundingBox();
  const pipBox = await whitePip.boundingBox();
  const checkerBox = await whiteChecker.boundingBox();
  const pipFontSize = await whitePip.evaluate((element: HTMLElement) =>
    parseFloat(getComputedStyle(element).fontSize),
  );

  expect(barBox).not.toBeNull();
  expect(pipBox).not.toBeNull();
  expect(checkerBox).not.toBeNull();
  expect(barBox!.width).toBeGreaterThanOrEqual(26);
  expect(pipFontSize).toBeGreaterThanOrEqual(11);
  expect(checkerBox!.y + checkerBox!.height).toBeLessThan(pipBox!.y);

  const pipCenter = pipBox!.y + pipBox!.height / 2;
  const checkerCenter = checkerBox!.y + checkerBox!.height / 2;
  expect((pipCenter - barBox!.y) / barBox!.height).toBeCloseTo(0.82, 1);
  expect((checkerCenter - barBox!.y) / barBox!.height).toBeCloseTo(0.62, 1);
});
