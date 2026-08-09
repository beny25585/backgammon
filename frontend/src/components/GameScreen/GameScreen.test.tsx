import { test, expect } from "@playwright/experimental-ct-react";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { makeGameState } from "../../test-utils/gameState";

test("opening result overlay shows both dice and the winner", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_result",
        turn: "white",
        openingRoll: { white: 5, black: 3 },
      })}
      context={{
        openingRollResult: { myDie: 5, opponentDie: 3, winner: "white" },
      }}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByText("You go first!")).toBeVisible();
  await expect(
    component.getByTestId("opening-result-overlay").getByText("Opponent"),
  ).toBeVisible();
});

test("opening roll prompt appears for the player whose turn it is", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_roll",
        turn: "white",
        openingRoll: { white: null, black: null },
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByText("Tap to roll")).toBeVisible();
});

test("roll prompt appears after a server auto-pass (stale dice in rolling state)", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "rolling",
        turn: "white",
        dice: [2, 4],
        remaining: [],
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByText("Tap to roll")).toBeVisible();
});
