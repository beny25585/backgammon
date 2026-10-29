import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
import GameBoard from "./GameBoard";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame } from "@/lib/backgammon/engine";
import styles from "./GameScreen.module.css";
import { assertNoHorizontalOverflow } from "../../test-utils/viewportChecks";
import type { GameState } from "@/lib/backgammon/engine";
import type { BoardTheme } from "../BoardThemeSelector/boardThemes";
import appStyles from "../../App.module.css";

const VIEWPORTS = [
  { name: "mobile-portrait", width: 375, height: 812 },
  { name: "compact-landscape", width: 474, height: 330 },
  { name: "mobile-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1280, height: 800 },
];

// Intermediate landscape widths must keep player details and clocks in view.
const PANEL_IN_VIEW = [
  { name: "small-landscape-768x600", width: 768, height: 600 },
  { name: "small-landscape-640x480", width: 640, height: 480 },
];

const MIN_LIMITING_AXIS_FILL = 0.85;

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

async function mountBoard(mount: ComponentFixtures["mount"], state: GameState, playerColor: "white" | "black" = "white") {
  return mount(
    <div className={appStyles.gameContent}>
      <div className={styles.container}>
        <MockGameWrapper playerColor={playerColor} state={state}>
          <GameBoard
            state={state}
            playerColor={playerColor}
            makeMove={() => {}}
            onLeave={() => {}}
          />
        </MockGameWrapper>
      </div>
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

  test(`game frame fills available width and stays stable when settings toggle (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const state = movingState();
    const component = await mountBoard(mount, state);

    const box = await page
      .getByTestId("board-frame")
      .evaluate((el) => el.getBoundingClientRect());
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);

    const portrait = vh > vw;
    const width = portrait ? box.height : box.width;
    const height = portrait ? box.width : box.height;
    const slot = await page.getByTestId("board-frame").locator("..").boundingBox();
    expect(slot).not.toBeNull();
    const availableWidth = portrait ? slot!.height : slot!.width;
    const availableHeight = portrait ? slot!.width : slot!.height;
    expect(
      Math.abs(width - availableWidth),
      `game frame should fill its available width (${vp.name})`,
    ).toBeLessThanOrEqual(1);
    expect(height).toBeLessThanOrEqual(availableHeight + 1);
    expect(height).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(vw + 1);
    expect(box.bottom).toBeLessThanOrEqual(vh + 1);
    // The frame fills its available width while its height stays within the viewport.
    expect(
      Math.max(box.width / vw, box.height / vh),
      `board should fill its limiting viewport axis (${vp.name})`,
    ).toBeGreaterThanOrEqual(MIN_LIMITING_AXIS_FILL);

    const board = component.getByTestId("board-wrapper");
    const before = await board.boundingBox();
    expect(before).not.toBeNull();

    const toggle = component.getByTestId("game-settings-toggle");
    const settings = component.getByTestId("game-settings-panel");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(settings).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(settings).toBeVisible();
    expect(await board.boundingBox()).toEqual(before);
    await settings.getByRole("combobox", { name: "Language" }).focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(settings).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await board.boundingBox()).toEqual(before);
  });

}

for (const vp of VIEWPORTS) {
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

test("landscape iPhone safe areas keep the clock and board out of the notch", async ({
  mount,
  page,
}) => {
  const viewport = { width: 844, height: 390 };
  const safeLeft = 47;
  const safeRight = 21;
  const safeTop = 7;
  const safeBottom = 12;
  await page.setViewportSize(viewport);
  await page.addStyleTag({
    content: `:root {
      --game-safe-left: ${safeLeft}px;
      --game-safe-right: ${safeRight}px;
      --game-safe-top: ${safeTop}px;
      --game-safe-bottom: ${safeBottom}px;
    }`,
  });

  const component = await mountBoard(mount, movingState());
  const frame = await component.getByTestId("board-frame").boundingBox();
  const clock = await component.getByTestId("clock-my").boundingBox();

  expect(frame).not.toBeNull();
  expect(clock).not.toBeNull();
  expect(frame!.x).toBeGreaterThanOrEqual(safeLeft);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(viewport.width - safeRight + 1);
  expect(frame!.y).toBeGreaterThanOrEqual(safeTop);
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(viewport.height - safeBottom + 1);
  expect(clock!.x).toBeGreaterThanOrEqual(safeLeft);
  expect(clock!.x + clock!.width).toBeLessThanOrEqual(viewport.width - safeRight + 1);
});

test("desktop dice keep their full size while mobile dice stay readable and smaller", async ({ mount, page }) => {
  const state = movingState();
  await page.setViewportSize({ width: 1280, height: 800 });
  let component = await mountBoard(mount, state);
  const desktopWidth = await component.getByTestId("dice-overlay").getByTestId("die").first().evaluate(
    (element: HTMLElement) => parseFloat(getComputedStyle(element).width),
  );
  expect(desktopWidth).toBeCloseTo(52, 1);

  await component.unmount();
  await page.setViewportSize({ width: 375, height: 812 });
  component = await mountBoard(mount, state);
  const mobileWidth = await component.getByTestId("dice-overlay").getByTestId("die").first().evaluate(
    (element: HTMLElement) => parseFloat(getComputedStyle(element).width),
  );
  expect(mobileWidth).toBeGreaterThanOrEqual(25.5);
  expect(mobileWidth).toBeLessThanOrEqual(42);
  expect(desktopWidth).toBeGreaterThan(mobileWidth);
});

test("mobile browser slightly insets the whole game", async ({ mount, page }) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);

  const component = await mountBoard(mount, movingState());
  const gameFrame = await component.getByTestId("board-frame").boundingBox();

  expect(gameFrame).not.toBeNull();
  expect(gameFrame!.x).toBeGreaterThanOrEqual(7);
  expect(gameFrame!.y).toBeGreaterThanOrEqual(5);
  expect(gameFrame!.x + gameFrame!.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(gameFrame!.y + gameFrame!.height).toBeLessThanOrEqual(viewport.height - 5);
});

for (const [theme, expectedAccent] of [
  ["redGreen", "rgb(143, 38, 51)"],
  ["blueIvory", "rgb(36, 72, 255)"],
  ["ivoryGold", "rgb(199, 149, 53)"],
  ["classicBrown", "rgb(214, 174, 99)"],
  ["classicLight", "rgb(214, 174, 99)"],
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

    await component.getByTestId("game-settings-toggle").press("Enter");
    const leaveColor = await component
      .getByTestId("game-settings-panel")
      .getByRole("button", { name: "Leave and forfeit match", exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    const dangerColor = await component.evaluate((element) => {
      const probe = document.createElement("span");
      probe.className = "text-red-300";
      element.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const rollColor = await component
      .getByTitle("Tap to roll")
      .locator("[data-button-surface]")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(leaveColor).toBe(dangerColor);
    expect(rollColor).toBe(expectedAccent);
  });
}

test("the settings toggle belongs to the player rail and the drawer opens over the left board edge", async ({ mount, page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const component = await mountBoard(mount, movingState());
  const rail = component.getByTestId("side-panel");
  const railBox = await rail.boundingBox();
  const toggle = rail.getByTestId("game-settings-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.press("Enter");
  const board = await component.getByTestId("board-wrapper").boundingBox();
  const settings = await component.getByTestId("game-settings-panel").boundingBox();
  const frame = await component.getByTestId("board-frame").boundingBox();
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(board!.x);
  expect(settings!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
  expect(settings!.x).toBeCloseTo(board!.x, 0);
  expect(settings!.x + settings!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
  await expect(rail.locator('[data-player="self"]').getByTestId("player-score-white")).toHaveCount(1);
  await expect(rail.locator('[data-player="opponent"]').getByTestId("player-score-black")).toHaveCount(1);
  for (const id of ["clock-my", "clock-opp"]) {
    const clock = await rail.getByTestId(id).boundingBox();
    expect(clock!.y).toBeGreaterThanOrEqual(railBox!.y);
    expect(clock!.y + clock!.height).toBeLessThanOrEqual(railBox!.y + railBox!.height);
  }
});
for (const viewport of [
  { name: "short-phone", width: 474, height: 330 },
  { name: "short-tablet", width: 844, height: 390 },
]) {
  test(`match controls stay inside the viewport with every option reachable (${viewport.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const state = movingState();
    const component = await mount(
      <div className={styles.container}>
        <MockGameWrapper playerColor="white" state={state}>
          <GameBoard
            state={state}
            playerColor="white"
            makeMove={() => {}}
            onLeave={() => {}}
            boardTheme="blueIvory"
            onBoardThemeChange={() => {}}
          />
        </MockGameWrapper>
      </div>,
    );

    await component.getByTestId("game-settings-toggle").press("Enter");
    const drawer = component.getByTestId("game-settings-panel");
    await expect(drawer).toBeVisible();
    const leaveButton = component.getByRole("button", { name: "Leave and forfeit match", exact: true });
    await leaveButton.scrollIntoViewIfNeeded();
    await expect(leaveButton).toBeVisible();
    const classicButton = component.getByRole("combobox", { name: "Board style" });
    await classicButton.scrollIntoViewIfNeeded();
    await expect(classicButton).toBeVisible();

    const fit = await drawer.evaluate((element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(viewport.height);
    expect(fit.clientHeight).toBeGreaterThan(0);
  });
}
