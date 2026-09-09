import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator } from "@playwright/test";
import GameBoard from "../GameScreen/GameBoard";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame, type GameState, type Source, type Target } from "@/lib/backgammon/engine";
import styles from "../GameScreen/GameScreen.module.css";

function position(): GameState {
  const points = new Array(24).fill(0);
  points[23] = 2;
  points[12] = 2;
  points[18] = -2;
  return { ...newGame(), points, turn: "white", phase: "moving", dice: [4, 3], remaining: [4, 3] };
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing board element");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const scenario of ["legal", "blocked", "outside", "source", "escape", "bar", "off", "black", "opponent", "wrong-turn"] as const) {
  test(`checker drag: ${scenario}`, async ({ mount, page }) => {
    const state = position();
    const color = scenario === "black" ? "black" : "white";
    let from: Source = 23;
    let to: Target = scenario === "blocked" ? 18 : scenario === "source" ? 23 : 20;
    if (scenario === "bar") { state.bar.white = 1; from = "bar"; }
    if (scenario === "off") {
      state.points.fill(0); state.points[3] = 2; state.points[5] = 2;
      state.home.white = 11;
      from = 3; to = "off";
    }
    if (scenario === "black") {
      state.turn = "black"; from = 18; to = 21;
    }
    if (scenario === "opponent") from = 18;
    if (scenario === "wrong-turn") state.turn = "black";
    const moves: [Source, Target][] = [];
    const component = await mount(
      <div className={styles.container}><MockGameWrapper state={state} playerColor={color}>
        <GameBoard state={state} playerColor={color} makeMove={(a, b) => moves.push([a, b])} />
      </MockGameWrapper></div>,
    );
    const source = component.locator(`[data-point-idx="${from}"] [data-checker]`).last();
    const start = await center(source);
    const end = scenario === "outside" ? { x: 1, y: 1 } : await center(
      to === "off" ? component.getByTestId("bear-off-bottom") : component.locator(`[data-point-idx="${to}"]`),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 10);
    const allowed = scenario !== "opponent" && scenario !== "wrong-turn";
    await expect(component.getByTestId("dragging-checker")).toHaveCount(allowed ? 1 : 0);
    expect(moves).toHaveLength(0);
    if (scenario === "escape") await page.keyboard.press("Escape");
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await expect(component.getByTestId("dragging-checker")).toHaveCount(0);
    if (["legal", "bar", "off", "black"].includes(scenario)) {
      await expect.poll(() => moves).toEqual([[from, to]]);
    } else {
      await page.waitForTimeout(100);
      expect(moves).toHaveLength(0);
      await expect(source).toBeVisible();
    }
  });
}

for (const cancel of [false, true]) {
  test(`touch checker drag ${cancel ? "cancels" : "moves once"} on mobile`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const state = position();
    const moves: [Source, Target][] = [];
    const component = await mount(
      <div className={styles.container}><MockGameWrapper state={state}>
        <GameBoard state={state} playerColor="white" makeMove={(a, b) => moves.push([a, b])} />
      </MockGameWrapper></div>,
    );
    const start = await center(component.locator('[data-point-idx="23"] [data-checker]').last());
    const end = await center(component.locator('[data-point-idx="20"]'));
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...end, id: 1 }] });
    await expect(component.getByTestId("dragging-checker")).toBeVisible();
    expect(moves).toHaveLength(0);
    await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    await expect(component.getByTestId("dragging-checker")).toHaveCount(0);
    if (cancel) expect(moves).toHaveLength(0);
    else await expect.poll(() => moves).toEqual([[23, 20]]);
    await session.detach();
  });
}

test("a new game position cancels an in-progress drag", async ({ mount, page }) => {
  const state = position();
  const moves: [Source, Target][] = [];
  const render = (current: GameState) => (
    <div className={styles.container}><MockGameWrapper state={current}>
      <GameBoard state={current} playerColor="white" makeMove={(a, b) => moves.push([a, b])} />
    </MockGameWrapper></div>
  );
  const component = await mount(render(state));
  const start = await center(component.locator('[data-point-idx="23"] [data-checker]').last());
  const end = await center(component.locator('[data-point-idx="20"]'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(component.getByTestId("dragging-checker")).toBeVisible();
  await component.update(render({ ...state, remaining: [4] }));
  await expect(component.getByTestId("dragging-checker")).toHaveCount(0);
  await page.mouse.up();
  expect(moves).toHaveLength(0);
});
