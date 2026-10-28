import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";
import {
  applyMove,
  newGame,
  OFF,
  type Color,
  type GameState,
  type Move,
} from "@/lib/backgammon/engine";
import { MultiDragHarness, type DragMoveCall } from "../../test-utils/MultiDragHarness";

const point = (whitePoint: number, color: Color) => color === "white" ? whitePoint : 23 - whitePoint;

function position(color: Color, remaining = [4, 3]): GameState {
  const sign = color === "white" ? 1 : -1;
  const points = Array<number>(24).fill(0);
  // Two independently movable stacks keep these gestures out of forced play.
  points[point(23, color)] = 2 * sign;
  points[point(12, color)] = 2 * sign;
  points[point(18, color)] = -2 * sign;
  return {
    ...newGame(),
    points,
    home: { [color]: 11, [color === "white" ? "black" : "white"]: 13 } as Record<Color, number>,
    turn: color,
    phase: "moving",
    dice: remaining.slice(0, 2),
    remaining,
    lastMove: [],
    moveHistory: [],
    version: 7,
  };
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing board element");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, source: Locator, target: Locator, input: "mouse" | "touch" = "mouse") {
  const start = await center(source);
  const end = await center(target);
  if (input === "touch") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...end, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    return;
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

for (const scenario of [
  { color: "white", input: "mouse", portrait: false },
  { color: "black", input: "touch", portrait: false },
  { color: "black", input: "mouse", portrait: true },
  { color: "white", input: "touch", portrait: true },
] as const) {
  test(`combined checker drag uses both dice once (${scenario.color}, ${scenario.input}, ${scenario.portrait ? "portrait" : "landscape"})`, async ({ mount, page }) => {
    const { color, input, portrait } = scenario;
    await page.setViewportSize(portrait ? { width: 390, height: 844 } : { width: 844, height: 390 });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const state = position(color);
    const calls: DragMoveCall[] = [];
    const render = (current: GameState) => (
      <MultiDragHarness state={current} playerColor={color} onMove={move => calls.push(move)} />
    );
    const component = await mount(render(state));
    const first: Move = { from: point(23, color), to: point(19, color), die: 4 };
    const second: Move = { from: point(19, color), to: point(16, color), die: 3 };
    await drag(
      page,
      component.locator(`[data-point-idx="${first.from}"] [data-checker]`).last(),
      component.locator(`[data-point-idx="${second.to}"]`),
      input,
    );
    await expect.poll(() => calls).toEqual([first]);
    const afterFirst = applyMove(state, first, color);
    await component.update(render(afterFirst));
    await page.clock.runFor(1400);
    await expect.poll(() => calls).toEqual([first, second]);
    await component.update(render(applyMove(afterFirst, second, color)));
    await page.clock.runFor(1400);
    expect(calls).toEqual([first, second]);
    await expect(component.locator(`[data-point-idx="${second.to}"] [data-checker]`)).toHaveCount(1);
  });
}

for (const color of ["white", "black"] as const) {
  test(`combined checker drag cannot jump both blocked intermediate points (${color})`, async ({ mount, page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const state = position(color);
    const sign = color === "white" ? 1 : -1;
    state.points[point(19, color)] = -2 * sign;
    state.points[point(20, color)] = -2 * sign;
    const calls: DragMoveCall[] = [];
    const component = await mount(
      <MultiDragHarness state={state} playerColor={color} onMove={move => calls.push(move)} />,
    );
    await drag(
      page,
      component.locator(`[data-point-idx="${point(23, color)}"] [data-checker]`).last(),
      component.locator(`[data-point-idx="${point(16, color)}"]`),
    );
    await page.clock.runFor(300);
    expect(calls).toEqual([]);
  });
}

test("combined checker drag uses all four doubles in order", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let state = position("white", [2, 2, 2, 2]);
  const calls: DragMoveCall[] = [];
  const expected: Move[] = [
    { from: 23, to: 21, die: 2 },
    { from: 21, to: 19, die: 2 },
    { from: 19, to: 17, die: 2 },
    { from: 17, to: 15, die: 2 },
  ];
  const render = (current: GameState) => (
    <MultiDragHarness state={current} playerColor="white" onMove={move => calls.push(move)} />
  );
  const component = await mount(render(state));
  await drag(page, component.locator('[data-point-idx="23"] [data-checker]').last(), component.locator('[data-point-idx="15"]'));
  for (let index = 0; index < expected.length; index += 1) {
    await expect.poll(() => calls).toEqual(expected.slice(0, index + 1));
    state = applyMove(state, expected[index], "white");
    await component.update(render(state));
    await page.clock.runFor(1400);
  }
  expect(calls).toEqual(expected);
  await expect(component.locator('[data-point-idx="15"] [data-checker]')).toHaveCount(1);
});

for (const color of ["white", "black"] as const) {
  test(`combined bear-off drag highlights the tray and uses both dice (${color})`, async ({ mount, page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const state = position(color, [2, 1]);
    const sign = color === "white" ? 1 : -1;
    state.points.fill(0);
    state.points[point(1, color)] = sign;
    state.points[point(23, color)] = -15 * sign;
    state.home = { white: color === "white" ? 14 : 0, black: color === "black" ? 14 : 0 };
    const calls: DragMoveCall[] = [];
    const first: Move = { from: point(1, color), to: point(0, color), die: 1 };
    const second: Move = { from: point(0, color), to: OFF, die: 2 };
    const render = (current: GameState) => (
      <MultiDragHarness state={current} playerColor={color} onMove={move => calls.push(move)} />
    );
    const component = await mount(render(state));
    const tray = component.getByTestId("bear-off-bottom");
    await expect(tray).toHaveAttribute("data-legal", "false");
    const start = await center(component.locator(`[data-point-idx="${first.from}"] [data-checker]`).last());
    const end = await center(tray);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(component.getByTestId("dragging-checker")).toBeVisible();
    await expect(tray).toHaveAttribute("data-legal", "true");
    await expect(tray).toBeEnabled();
    expect(calls).toEqual([]);
    await page.mouse.up();
    await expect.poll(() => calls).toEqual([first]);
    const afterFirst = applyMove(state, first, color);
    await component.update(render(afterFirst));
    await page.clock.runFor(1400);
    await expect.poll(() => calls).toEqual([first, second]);
    const borneOff = applyMove(afterFirst, second, color);
    await component.update(render(borneOff));
    await page.clock.runFor(1400);
    expect(calls).toEqual([first, second]);
    await expect(component.locator(`[data-borne-off-count="${color}"]`)).toHaveText("15");
  });
}

test("combined checker drag waits for acknowledgement despite an optimistic version update", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const state = position("white");
  const calls: DragMoveCall[] = [];
  const first: Move = { from: 23, to: 19, die: 4 };
  const second: Move = { from: 19, to: 16, die: 3 };
  const render = (current: GameState, pending: boolean) => (
    <MultiDragHarness state={current} playerColor="white" pending={pending} onMove={move => calls.push(move)} />
  );
  const component = await mount(render(state, false));
  await drag(page, component.locator('[data-point-idx="23"] [data-checker]').last(), component.locator('[data-point-idx="16"]'));
  await expect.poll(() => calls).toEqual([first]);
  const optimistic = { ...applyMove(state, first, "white"), version: 8 };
  await component.update(render(optimistic, true));
  await page.clock.runFor(1400);
  expect(calls).toEqual([first]);
  await component.update(render(optimistic, false));
  await page.clock.runFor(100);
  await expect.poll(() => calls).toEqual([first, second]);
  await component.update(render(applyMove(optimistic, second, "white"), false));
  await page.clock.runFor(1400);
  expect(calls).toEqual([first, second]);
});

for (const changed of ["position", "turn", "player"] as const) {
  test(`combined checker drag cancels its unsent remainder after ${changed} changes`, async ({ mount, page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const state = position("white");
    const calls: DragMoveCall[] = [];
    const first: Move = { from: 23, to: 19, die: 4 };
    const render = (current: GameState, color: Color = "white") => (
      <MultiDragHarness state={current} playerColor={color} onMove={move => calls.push(move)} />
    );
    const component = await mount(render(state));
    await drag(page, component.locator('[data-point-idx="23"] [data-checker]').last(), component.locator('[data-point-idx="16"]'));
    await expect.poll(() => calls).toEqual([first]);
    const afterFirst = applyMove(state, first, "white");
    const unexpected = {
      ...afterFirst,
      points: [...afterFirst.points],
      turn: changed === "turn" ? "black" as const : "white" as const,
    };
    if (changed === "position") unexpected.points[12] += 1;
    await component.update(render(unexpected, changed === "player" ? "black" : "white"));
    await page.clock.runFor(300);
    // Restoring the old state must not resurrect the abandoned path.
    await component.update(render(afterFirst));
    await page.clock.runFor(1400);
    expect(calls).toEqual([first]);
  });
}

test("combined checker drag abandons a timed out acknowledgement", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const state = position("white");
  const calls: DragMoveCall[] = [];
  const first: Move = { from: 23, to: 19, die: 4 };
  const render = (current: GameState, pending: boolean) => (
    <MultiDragHarness state={current} playerColor="white" pending={pending} onMove={move => calls.push(move)} />
  );
  const component = await mount(render(state, false));
  await drag(page, component.locator('[data-point-idx="23"] [data-checker]').last(), component.locator('[data-point-idx="16"]'));
  await expect.poll(() => calls).toEqual([first]);
  const afterFirst = applyMove(state, first, "white");
  await component.update(render(afterFirst, true));
  await page.clock.runFor(2500);
  await component.update(render(afterFirst, false));
  await page.clock.runFor(1400);
  expect(calls).toEqual([first]);
});
