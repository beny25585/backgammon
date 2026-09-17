import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
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

async function mountBoard(mount: ComponentFixtures["mount"], state: GameState) {
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

const SHORT_LANDSCAPE_VIEWPORTS = [
  { width: 844, height: 390 },
  { width: 915, height: 350 },
];

// Strict head-to-head regression coverage for short landscape phones:
// opposing five-checker stacks must never visually crowd at the board center,
// and the point-number gutters must stay solid black.
const HEAD_TO_HEAD_VIEWPORTS = [
  { width: 667, height: 375 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 915, height: 350 },
  { width: 932, height: 430 },
  // Enters the mobile rule through width < 800 while taller than 430px.
  { width: 740, height: 500 },
];

const HEAD_TO_HEAD_POINTS = [12, 11, 18, 5];
const HEAD_TO_HEAD_PAIRS: Array<[number, number]> = [
  [12, 11],
  [18, 5],
];
const MIN_OPPOSING_STACK_GAP_PX = 4;
const STACK_OVERLAP_TOLERANCE_PX = 0.5;

function headToHeadFiveStackState(): GameState {
  const state = busyState();
  state.points = new Array(24).fill(0);

  state.points[12] = 5;
  state.points[11] = -5;

  state.points[18] = 5;
  state.points[5] = -5;

  return state;
}

type BoardComponent = Awaited<ReturnType<typeof mountBoard>>;

interface RectBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

async function checkerBoxes(
  component: BoardComponent,
  pointIdx: number,
): Promise<RectBox[]> {
  return component
    .locator(`[data-point-idx="${pointIdx}"] [data-checker]`)
    .evaluateAll((els: HTMLElement[]) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      }),
    );
}

async function pointBox(
  component: BoardComponent,
  pointIdx: number,
): Promise<RectBox> {
  return component
    .locator(`[data-point-idx="${pointIdx}"]`)
    .evaluate((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    });
}

async function opposingStackGap(
  component: BoardComponent,
  topIdx: number,
  bottomIdx: number,
): Promise<number> {
  const topBoxes = await checkerBoxes(component, topIdx);
  const bottomBoxes = await checkerBoxes(component, bottomIdx);
  const topBottom = Math.max(...topBoxes.map((box) => box.bottom));
  const bottomTop = Math.min(...bottomBoxes.map((box) => box.top));
  return bottomTop - topBottom;
}

async function assertHeadToHeadGeometry(
  component: BoardComponent,
  label: string,
) {
  for (const index of HEAD_TO_HEAD_POINTS) {
    const point = component.locator(`[data-point-idx="${index}"]`);
    await expect(point.locator("[data-checker]")).toHaveCount(5);
    const bounds = await pointBox(component, index);
    const boxes = await checkerBoxes(component, index);
    expect(
      boxes,
      `point ${index} must render five checkers (${label})`,
    ).toHaveLength(5);
    for (const box of boxes) {
      expect(
        box.width,
        `checker width must be positive on point ${index} (${label})`,
      ).toBeGreaterThan(0);
      expect(
        box.height,
        `checker height must be positive on point ${index} (${label})`,
      ).toBeGreaterThan(0);
      expect(
        box.width,
        `checker must stay usable (>= ${MIN_CHECKER_PX}px) on point ${index} (${label})`,
      ).toBeGreaterThanOrEqual(MIN_CHECKER_PX);
      expect(
        Math.abs(box.width - box.height),
        `checker must stay circular on point ${index} (${label})`,
      ).toBeLessThan(1);
      expect(
        box.top,
        `checker must stay inside point ${index} (${label})`,
      ).toBeGreaterThanOrEqual(bounds.top - STACK_OVERLAP_TOLERANCE_PX);
      expect(
        box.bottom,
        `checker must stay inside point ${index} (${label})`,
      ).toBeLessThanOrEqual(bounds.bottom + STACK_OVERLAP_TOLERANCE_PX);
      expect(
        box.left,
        `checker must stay inside point ${index} (${label})`,
      ).toBeGreaterThanOrEqual(bounds.left - STACK_OVERLAP_TOLERANCE_PX);
      expect(
        box.right,
        `checker must stay inside point ${index} (${label})`,
      ).toBeLessThanOrEqual(bounds.right + STACK_OVERLAP_TOLERANCE_PX);
    }
    const sorted = [...boxes].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i]!.top,
        `checkers on point ${index} must not overlap (${label})`,
      ).toBeGreaterThanOrEqual(
        sorted[i - 1]!.bottom - STACK_OVERLAP_TOLERANCE_PX,
      );
    }
  }

  for (const [topIdx, bottomIdx] of HEAD_TO_HEAD_PAIRS) {
    const gap = await opposingStackGap(component, topIdx, bottomIdx);
    expect(
      gap,
      `opposing stacks ${topIdx}/${bottomIdx} need >= ${MIN_OPPOSING_STACK_GAP_PX}px center clearance (${label}, got ${gap.toFixed(2)})`,
    ).toBeGreaterThanOrEqual(MIN_OPPOSING_STACK_GAP_PX);
  }
}

for (const vp of HEAD_TO_HEAD_VIEWPORTS) {
  test(
    `head-to-head five-stacks keep clearance at ${vp.width}x${vp.height}`,
    async ({ mount, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const component = await mountBoard(mount, headToHeadFiveStackState());
      await expect(
        component.locator('[data-point-idx="12"] [data-checker]'),
      ).toHaveCount(5);
      await assertHeadToHeadGeometry(component, `${vp.width}x${vp.height}`);
    },
  );

  test(
    `point-number gutters stay black at ${vp.width}x${vp.height}`,
    async ({ mount, page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const component = await mountBoard(mount, headToHeadFiveStackState());

      const frame = component.getByTestId("board-inner-frame");
      await expect(frame).toHaveCount(1);

      const frameBg = await frame.evaluate((el: HTMLElement) => {
        const computed = getComputedStyle(el);
        return {
          color: computed.backgroundColor,
          image: computed.backgroundImage,
        };
      });
      expect(
        frameBg.color,
        `frame gutter must be black (${vp.width}x${vp.height}, got ${frameBg.color})`,
      ).toBe("rgb(0, 0, 0)");
      expect(
        frameBg.image,
        `frame must not paint a theme gradient over the gutter (${vp.width}x${vp.height})`,
      ).toBe("none");

      const framePseudo = await frame.evaluate((el: HTMLElement) => {
        const before = getComputedStyle(el, "::before");
        const after = getComputedStyle(el, "::after");
        return {
          beforeDisplay: before.display,
          afterDisplay: after.display,
        };
      });
      expect(
        framePseudo.beforeDisplay,
        `frame::before must not paint over the black gutter (${vp.width}x${vp.height})`,
      ).toBe("none");
      expect(
        framePseudo.afterDisplay,
        `frame::after must not paint over the black gutter (${vp.width}x${vp.height})`,
      ).toBe("none");

      const pointNumbers = component.getByTestId("point-number");
      await expect(pointNumbers).toHaveCount(24);

      const wrapperBox = await component.getByTestId("board-wrapper").boundingBox();
      expect(wrapperBox).not.toBeNull();
      const outOfBounds = await pointNumbers.evaluateAll(
        (elements, bounds) =>
          elements
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                text: element.textContent,
                inside:
                  rect.top >= bounds.top - 1 &&
                  rect.bottom <= bounds.bottom + 1,
              };
            })
            .filter((result) => !result.inside),
        { top: wrapperBox!.y, bottom: wrapperBox!.y + wrapperBox!.height },
      );
      expect(
        outOfBounds,
        `all 24 point numbers must stay inside the visible wrapper at ${vp.width}x${vp.height}`,
      ).toEqual([]);

      const innerBox = await component
        .getByTestId("board-inner")
        .evaluate((el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
      const topCenters = await component
        .locator('[class*="pointNumberTop"]')
        .evaluateAll((els: HTMLElement[]) =>
          els.map((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top + rect.height / 2;
          }),
        );
      const bottomCenters = await component
        .locator('[class*="pointNumberBottom"]')
        .evaluateAll((els: HTMLElement[]) =>
          els.map((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top + rect.height / 2;
          }),
        );
      expect(topCenters).toHaveLength(12);
      expect(bottomCenters).toHaveLength(12);
      for (const centerY of topCenters) {
        expect(
          centerY,
          `top point number must sit above the playing field (${vp.width}x${vp.height})`,
        ).toBeLessThan(innerBox.top);
      }
      for (const centerY of bottomCenters) {
        expect(
          centerY,
          `bottom point number must sit below the playing field (${vp.width}x${vp.height})`,
        ).toBeGreaterThan(innerBox.bottom);
      }
    },
  );
}

test("head-to-head stacks keep clearance across viewport resize without remount", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 430 });
  const component = await mountBoard(mount, headToHeadFiveStackState());
  await expect(
    component.locator('[data-point-idx="12"] [data-checker]'),
  ).toHaveCount(5);

  await page.setViewportSize({ width: 844, height: 350 });

  await expect
    .poll(() => opposingStackGap(component, 12, 11), { timeout: 5000 })
    .toBeGreaterThanOrEqual(MIN_OPPOSING_STACK_GAP_PX);
  await assertHeadToHeadGeometry(component, "844x350 after resize");
});

for (const vp of SHORT_LANDSCAPE_VIEWPORTS) {
  test(
    `point numbers stay inside visible board on short landscape ${vp.width}x${vp.height}`,
    async ({ mount, page }) => {
      await page.setViewportSize(vp);

      const component = await mountBoard(mount, busyState());

      const wrapper = component.getByTestId("board-wrapper");
      const pointNumbers = component.getByTestId("point-number");

      await expect(pointNumbers).toHaveCount(24);

      const wrapperBox = await wrapper.boundingBox();

      expect(wrapperBox).not.toBeNull();

      const visibleBounds = {
        top: wrapperBox!.y,
        bottom: wrapperBox!.y + wrapperBox!.height,
      };

      const outOfBounds = await pointNumbers.evaluateAll(
        (elements, bounds) =>
          elements
            .map((element) => {
              const rect = element.getBoundingClientRect();

              return {
                text: element.textContent,
                top: rect.top,
                bottom: rect.bottom,
                inside:
                  rect.top >= bounds.top - 1 &&
                  rect.bottom <= bounds.bottom + 1,
              };
            })
            .filter((result) => !result.inside),
        visibleBounds,
      );

      expect(
        outOfBounds,
        `all 24 point numbers must stay inside the visible wrapper at ${vp.width}x${vp.height}`,
      ).toEqual([]);
    },
  );
}
