import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
import GuidanceBanner from "./GuidanceBanner";
import { makeGameState } from "../../test-utils/gameState";
import type { GameState } from "@/lib/backgammon/engine";

interface MountProps {
  phase: GameState["phase"];
  turn?: "white" | "black";
  playerColor?: "white" | "black";
  dice?: number[];
  remaining?: number[];
  respondToDouble?: (accept: boolean) => void;
}

async function mountBanner(mount: ComponentFixtures["mount"], props: MountProps) {
  const { phase, turn, playerColor = "white", dice = [], remaining = [], respondToDouble } = props;
  const state = makeGameState({ phase, turn, dice, remaining });
  return mount(
    <GuidanceBanner
      state={state}
      playerColor={playerColor}
      respondToDouble={respondToDouble ?? (() => {})}
    />,
  );
}

test("renders null during game_over", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "game_over" });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides routine roll guidance", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "rolling", turn: "white" });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides routine opening-roll guidance", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "opening_roll", turn: "white" });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides routine move guidance", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides routine opponent-turn guidance", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "black",
    playerColor: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides routine confirmation guidance", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "moving", turn: "white", remaining: [] });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("hides no-moves guidance because the board owns transient status", async ({ mount }) => {
  const points = new Array(24).fill(0);
  points[18] = -2; // black blockade on white's entry point for die 6
  const state = makeGameState({
    phase: "moving",
    turn: "white",
    dice: [6],
    remaining: [6],
    bar: { white: 1, black: 0 },
    points,
  });
  const c = await mount(
    <GuidanceBanner state={state} playerColor="white" respondToDouble={() => {}} />,
  );
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("double offer accepts once and disables both actions", async ({ mount }) => {
  let accepted: boolean | null = null;
  const state = makeGameState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
  });
  const c = await mount(
    <GuidanceBanner
      state={state}
      playerColor="white"
      respondToDouble={(a) => (accepted = a)}
    />,
  );
  await expect(c.getByTestId("guidance-banner")).toContainText("Opponent offers a double!");
  await c.getByTestId("double-accept").click();
  await expect.poll(() => accepted).toBe(true);
  await expect(c.getByTestId("double-accept")).toBeDisabled();
  await expect(c.getByTestId("double-decline")).toBeDisabled();
});

test("double offer can be declined", async ({ mount }) => {
  let accepted: boolean | null = null;
  const state = makeGameState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
  });
  const c = await mount(
    <GuidanceBanner
      state={state}
      playerColor="white"
      respondToDouble={(value) => (accepted = value)}
    />,
  );
  await c.getByTestId("double-decline").click();
  await expect.poll(() => accepted).toBe(false);
});

test("double offer cannot be dismissed before a response", async ({ mount }) => {
  const state = makeGameState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
  });
  const c = await mount(
    <GuidanceBanner state={state} playerColor="white" respondToDouble={() => {}} />,
  );
  await expect(c.getByTestId("banner-dismiss")).toHaveCount(0);
  await expect(c.getByTestId("double-accept")).toBeVisible();
  await expect(c.getByTestId("double-decline")).toBeVisible();
});

test("places Pass on the left and Take on the right", async ({ mount, page }) => {
  await page.setViewportSize({ width: 474, height: 330 });
  const state = makeGameState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
  });
  const c = await mount(
    <div style={{ position: "relative", width: "374px", height: "330px" }}>
      <GuidanceBanner state={state} playerColor="white" respondToDouble={() => {}} />
    </div>,
  );
  const passBox = await c.getByTestId("double-decline").boundingBox();
  const takeBox = await c.getByTestId("double-accept").boundingBox();
  expect(passBox).not.toBeNull();
  expect(takeBox).not.toBeNull();
  expect(passBox!.x).toBeLessThan(takeBox!.x);
});
