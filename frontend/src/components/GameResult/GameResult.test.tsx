import { test, expect } from "@playwright/experimental-ct-react";
import TournamentGameResult from "./TournamentGameResult";

test("tournament result keeps self on the left when self is black", async ({
  mount,
}) => {
  const component = await mount(
    <TournamentGameResult
      winner="white"
      whiteScore={1}
      blackScore={0}
      whiteName="Alice"
      blackName="Bob"
      playerColor="black"
      winnerIsWhite={false}
      onClose={() => {}}
    />,
  );

  const text = await component.textContent();
  expect(text).toContain("Lost");
  expect(text).toContain("Won");
  expect(text?.indexOf("Lost")).toBeLessThan(text?.indexOf("Won") ?? 0);
  await expect(component.getByText("Bob").first()).toBeVisible();
  await expect(component.getByText("Alice").first()).toBeVisible();
});

test("tournament round and next opponent are rendered once as match detail rows", async ({
  mount,
}) => {
  const component = await mount(
    <TournamentGameResult
      winner="white"
      whiteScore={1}
      blackScore={0}
      whiteName="Alice"
      blackName="Bob"
      playerColor="black"
      winnerIsWhite={false}
      tournamentRound="Quarter Final"
      nextOpponent="Alice"
      onClose={() => {}}
    />,
  );

  await expect(component.locator("text=Round: Quarter Final")).toHaveCount(1);
  await expect(component.locator("text=Next Match: Alice")).toHaveCount(1);
});

test("tournament hides next opponent when it is unknown", async ({ mount }) => {
  const component = await mount(
    <TournamentGameResult
      winner="white"
      whiteScore={1}
      blackScore={0}
      whiteName="Alice"
      blackName="Bob"
      playerColor="black"
      winnerIsWhite={false}
      nextOpponent={null}
      onClose={() => {}}
    />,
  );

  await expect(component.locator("text=Next Match:")).toHaveCount(0);
});

test("tournament uses backend-provided rating change when available", async ({
  mount,
}) => {
  const component = await mount(
    <TournamentGameResult
      winner="white"
      whiteScore={1}
      blackScore={0}
      whiteName="Alice"
      blackName="Bob"
      playerColor="black"
      winnerIsWhite={false}
      ratingBefore={900}
      ratingAfter={915}
      ratingChange={11}
      opponentRatingBefore={980}
      opponentRatingAfter={965}
      opponentRatingChange={-15}
      onClose={() => {}}
    />,
  );

  await expect(component.getByText("+11")).toBeVisible();
  await expect(component.getByText("-15")).toBeVisible();
  await expect(component.getByText("915 (+11)")).toBeVisible();
  await expect(component.getByText("965 (-15)")).toBeVisible();
});
