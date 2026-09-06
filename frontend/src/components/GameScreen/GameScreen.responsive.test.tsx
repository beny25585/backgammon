import { test, expect } from "@playwright/experimental-ct-react";
import GameBoard from "./GameBoard";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame } from "@/lib/backgammon/engine";
import styles from "./GameScreen.module.css";
import { assertNoHorizontalOverflow } from "../../test-utils/viewportChecks";
import type { GameState } from "@/lib/backgammon/engine";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";

const VIEWPORTS = [
  { name: "mobile-portrait", width: 375, height: 812 },
  { name: "compact-landscape", width: 474, height: 330 },
  { name: "mobile-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1280, height: 800 },
];

// Landscape viewports that are less than 800px wide trigger the
// mobile stacking layout, which can push the side panel below the
// visible area if the board consumes the full viewport height.
const PANEL_IN_VIEW = [
  { name: "small-landscape-768x600", width: 768, height: 600 },
  { name: "small-landscape-640x480", width: 640, height: 480 },
];

const MIN_CHECKER_PX = 16;
const MIN_FILL_WIDTH = 0.85;
const MIN_FILL_HEIGHT = 0.8;

function movingState(overrides: Partial<GameState> = {}): GameState {
  const points = new Array(24).fill(0);
  points[23] = 5;
  points[0] = -5;
  return {
    ...newGame(),
    points,
    bar: { white: 1, black: 1 },
    home: { white: 3, black: 3 },
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
    ...overrides,
  };
}

async function mountBoard(mount: any, state: GameState, playerColor: "white" | "black" = "white") {
  return mount(
    <div className={styles.container}>
      <MockGameWrapper playerColor={playerColor} state={state}>
        <GameBoard
          state={state}
          playerColor={playerColor}
          makeMove={() => {}}
          onLeave={() => {}}
        />
      </MockGameWrapper>
    </div>,
  );
}

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at any size (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    await mountBoard(mount, state);

    await assertNoHorizontalOverflow(page.locator("body"));
    await assertNoHorizontalOverflow(page.locator("html"));
    await assertNoHorizontalOverflow(page.getByTestId("board-frame"));
  });

  test(`board fills the screen (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    await mountBoard(mount, state);

    const box = await page
      .getByTestId("board-frame")
      .evaluate((el) => el.getBoundingClientRect());
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);

    expect(
      box.width / vw,
      `board width should fill >= ${MIN_FILL_WIDTH * 100}% of viewport (${vp.name})`,
    ).toBeGreaterThanOrEqual(MIN_FILL_WIDTH);
    expect(
      box.height / vh,
      `board height should fill >= ${MIN_FILL_HEIGHT * 100}% of viewport (${vp.name})`,
    ).toBeGreaterThanOrEqual(MIN_FILL_HEIGHT);
  });

  test(`checkers are not too small (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    const component = await mountBoard(mount, state);

    await expect(component.locator("[data-checker]").first()).toBeVisible();
    const checkerPx = await component
      .locator("[data-checker]")
      .first()
      .evaluate((el: HTMLElement) => getComputedStyle(el).width);
    const value = parseFloat(checkerPx);
    expect(
      value,
      `checker size should be >= ${MIN_CHECKER_PX}px (${vp.name}, got ${checkerPx})`,
    ).toBeGreaterThanOrEqual(MIN_CHECKER_PX);
  });

  test(`dice overlay and side panel are visible (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    const component = await mountBoard(mount, state);

    await expect(component.getByTestId("dice-overlay")).toBeVisible();
    await expect(component.getByTestId("side-panel")).toBeVisible();
  });
}

for (const vp of PANEL_IN_VIEW) {
  test(`side panel stays within the viewport (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    const component = await mountBoard(mount, state);

    await expect(component.getByTestId("side-panel")).toBeVisible();
    const box = await component.getByTestId("side-panel").boundingBox();
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box, `panel should have a bounding box (${vp.name})`).not.toBeNull();
    expect(box!.y, `panel top should not be below the viewport (${vp.name})`).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `panel bottom should stay within the viewport (${vp.name}, panel bottom ${Math.round(box!.y + box!.height)} vs viewport ${vh})`,
    ).toBeLessThanOrEqual(vh + 1);
  });
}

for (const [theme, expectedAccent] of [
  ["redGreen", "rgb(143, 38, 51)"],
  ["blueIvory", "rgb(36, 72, 255)"],
  ["ivoryGold", "rgb(199, 149, 53)"],
] as const satisfies ReadonlyArray<readonly [BoardTheme, string]>) {
  test(`game controls use the ${theme} accent`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 474, height: 330 });
    const state = movingState({ phase: "rolling", dice: [], remaining: [] });
    const component = await mount(
      <div className={styles.container}>
        <MockGameWrapper playerColor="white" state={state}>
          <GameBoard
            state={state}
            playerColor="white"
            makeMove={() => {}}
            needsToRoll
            onRoll={() => {}}
            offerDouble={() => {}}
            onLeave={() => {}}
            boardTheme={theme}
          />
        </MockGameWrapper>
      </div>,
    );

    const menuColor = await component
      .getByRole("button", { name: "Match control" })
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const rollColor = await component
      .getByTitle("Tap to roll")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(menuColor).toBe(expectedAccent);
    expect(rollColor).toBe(expectedAccent);
  });
}

test("hamburger is centered with both bear-off trays", async ({ mount, page }) => {
  await page.setViewportSize({ width: 474, height: 330 });
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mount(
    <div className={styles.container}>
      <MockGameWrapper playerColor="white" state={state}>
        <GameBoard
          state={state}
          playerColor="white"
          makeMove={() => {}}
          needsToRoll
          onRoll={() => {}}
          offerDouble={() => {}}
          onLeave={() => {}}
        />
      </MockGameWrapper>
    </div>,
  );

  const menu = await component.getByRole("button", { name: "Match control" }).boundingBox();
  const top = await component.getByTestId("bear-off-top").boundingBox();
  const bottom = await component.getByTestId("bear-off-bottom").boundingBox();
  expect(menu).not.toBeNull();
  expect(top).not.toBeNull();
  expect(bottom).not.toBeNull();
  const centerX = (box: NonNullable<typeof menu>) => box.x + box.width / 2;
  expect(Math.abs(centerX(menu!) - centerX(top!))).toBeLessThanOrEqual(1);
  expect(Math.abs(centerX(menu!) - centerX(bottom!))).toBeLessThanOrEqual(1);
});
