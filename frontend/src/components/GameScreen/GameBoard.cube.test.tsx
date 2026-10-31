import { test, expect } from "@playwright/experimental-ct-react";
import GameBoard from "./GameBoard";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame, offerDouble, respondDouble, type GameState, type MatchContext } from "../../lib/backgammon/engine";

const match: MatchContext = { targetPoints: 3, matchScore: { white: 0, black: 0 } };

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("bg_auto_roll", "false"));
});

for (const color of ["white", "black"] as const) {
  test(`${color}: GameScreen passes the match score through to its double action`, async ({ mount }) => {
    const state: GameState = {
      ...newGame(), phase: "rolling", turn: color, gameFormat: "match", cube: 4, cubeOwner: color,
    };
    let offers = 0;
    const render = (current: GameState) => (
      <MockGameWrapper playerColor={color} state={current}
        context={{ ...match, offerDouble: () => offers++ }}>
        <GameScreen />
      </MockGameWrapper>
    );
    const component = await mount(render(state));
    const doubleButton = component.getByTitle("Offer double to opponent").first();
    await expect(doubleButton).toBeDisabled();
    await component.update(render({ ...state, cube: 2 }));
    await expect(doubleButton).toBeEnabled();
    await doubleButton.click();
    expect(offers).toBe(1);
  });

  test(`${color}: accepting with old dice shows roll and cannot confirm or move`, async ({ mount }) => {
    const before: GameState = {
      ...newGame(), phase: "rolling", turn: color, gameFormat: "match",
      dice: [6, 1], remaining: [], moveHistory: [newGame()],
    };
    const state = respondDouble(offerDouble(before, color, match), true);
    let moves = 0;
    let confirmations = 0;
    let rolls = 0;
    const component = await mount(
      <MockGameWrapper playerColor={color} state={state}>
        <GameBoard state={state} playerColor={color} match={match} makeMove={() => moves++}
          endTurn={() => confirmations++} needsToRoll={true} onRoll={() => rolls++} />
      </MockGameWrapper>,
    );
    await expect(component.getByTitle("Confirm and end your turn")).toHaveCount(0);
    const rollButton = component.getByTitle("Tap to roll");
    await expect(rollButton).toBeVisible();
    await component.locator(`[data-point-idx="${color === "white" ? 23 : 0}"]`).click();
    await component.locator(`[data-point-idx="${color === "white" ? 22 : 1}"]`).click();
    expect(moves).toBe(0);
    expect(confirmations).toBe(0);
    await rollButton.click();
    expect(rolls).toBe(1);
  });
}
