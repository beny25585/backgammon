import { useState } from "react";
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

test("shows roll text on my turn in rolling phase", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "rolling", turn: "white" });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "roll");
  await expect(c.getByText("Your turn — tap to roll")).toBeVisible();
});

test("shows opening roll text on my turn", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "opening_roll", turn: "white" });
  await expect(c.getByText("Roll to start")).toBeVisible();
});

test("shows move text without dice during my moving turn", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "move");
  await expect(c.getByText("Your turn — tap a checker to move")).toBeVisible();
  await expect(c.getByTestId("die")).toHaveCount(0);
});

test("shows opponent thinking text on opponent's turn", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "black",
    playerColor: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByText("Opponent is thinking…")).toBeVisible();
});

test("shows confirm text when all dice used", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "moving", turn: "white", remaining: [] });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "confirm");
  await expect(c.getByText("Confirm your turn")).toBeVisible();
});

test("shows no-moves text when nothing legal is available", async ({ mount }) => {
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
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "no-moves");
  await expect(c.getByText("No moves available — turn passes")).toBeVisible();
});

test("double offer shows Accept/Decline that call respondToDouble", async ({ mount }) => {
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
  await expect(c.getByText("Opponent offers a double!")).toBeVisible();
  await c.getByTestId("double-accept").click();
  await expect.poll(() => accepted).toBe(true);
  await c.getByTestId("double-decline").click();
  await expect.poll(() => accepted).toBe(false);
});

function DismissHarness() {
  const [state, setState] = useState(() =>
    makeGameState({ phase: "moving", turn: "white", remaining: [] }),
  );
  return (
    <div>
      <GuidanceBanner state={state} playerColor="white" respondToDouble={() => {}} />
      <button
        type="button"
        data-testid="change-state"
        onClick={() =>
          setState(makeGameState({ phase: "rolling", turn: "white", remaining: [] }))
        }
      >
        change
      </button>
    </div>
  );
}

test("dismiss hides the banner until the guidance changes", async ({ mount }) => {
  const c = await mount(<DismissHarness />);
  await expect(c.getByText("Confirm your turn")).toBeVisible();

  await c.getByTestId("banner-dismiss").click();
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);

  await c.getByTestId("change-state").click();
  await expect(c.getByTestId("guidance-banner")).toBeVisible();
  await expect(c.getByText("Your turn — tap to roll")).toBeVisible();
});

test("dismiss button is present on every banner", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "rolling", turn: "white" });
  await expect(c.getByTestId("banner-dismiss")).toBeVisible();
});