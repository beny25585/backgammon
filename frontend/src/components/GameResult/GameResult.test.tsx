import { test, expect } from "@playwright/experimental-ct-react";
import TournamentGameResult from "./TournamentGameResult";
import PrivateGameResult from "./PrivateGameResult";
import QuickGameResult from "./QuickGameResult";

test("tournament result keeps self on the left when self is black", async ({ mount }) => {
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

test("tournament round and next opponent are rendered once as match detail rows", async ({ mount }) => {
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

test("tournament uses backend-provided rating change when available", async ({ mount }) => {
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
});

test("tournament exposes data-result-variant and game-result-card", async ({ mount }) => {
  const component = await mount(
    <TournamentGameResult
      winner="white"
      whiteScore={2}
      blackScore={1}
      whiteName="Alice"
      blackName="Bob"
      playerColor="white"
      winnerIsWhite={true}
      onClose={() => {}}
    />,
  );
  await expect(component.getByTestId("game-result-card")).toHaveAttribute("data-result-variant", "tournament");
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByTestId("score-right")).toBeVisible();
  await expect(component.getByRole("button", { name: /Back to Tournament|View Tournament|View Bracket/i }).first()).toBeVisible();
});

test("private result shows players, scores, details, rematch and variant", async ({ mount }) => {
  const component = await mount(
    <PrivateGameResult
      winner="white"
      whiteScore={3}
      blackScore={1}
      whiteName="Alice"
      blackName="Bob"
      playerColor="white"
      winType="Gammon"
      cube={2}
      hits={3}
      doublesOffered={1}
      doublesAccepted={1}
      openingRoll={{ white: 5, black: 2 }}
      firstPlayer="white"
      durationSeconds={123}
      clockRemaining={{ white: 120, black: 110 }}
      onClose={() => {}}
      onRematch={() => {}}
      rematchState={{ status: "available" }}
    />,
  );
  await expect(component.getByText("Alice").first()).toBeVisible();
  await expect(component.getByText("Bob").first()).toBeVisible();
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByTestId("score-right")).toBeVisible();
  await expect(component.getByTestId("score-white")).toHaveText("3");
  await expect(component.getByTestId("score-black")).toHaveText("1");
  await expect(component.getByTestId("game-result-card")).toHaveAttribute("data-result-variant", "private");
  await expect(component.locator("text=Doubling Cube")).toBeVisible();
  await expect(component.locator("text=Hits")).toBeVisible();
  await expect(component.getByRole("button", { name: /Rematch/i })).toBeVisible();
  const backHomeAction = component
    .getByRole("button")
    .filter({ hasText: "Back to Home" });

  await expect(backHomeAction).toHaveCount(1);
  await expect(backHomeAction).toBeVisible();
});

test("quick result shows rating, coins, doubling cube and variant", async ({ mount }) => {
  const component = await mount(
    <QuickGameResult
      winner="black"
      whiteScore={1}
      blackScore={2}
      whiteName="Alice"
      blackName="Bob"
      playerColor="white"
      cube={2}
      ratingBefore={1200}
      ratingAfter={1210}
      ratingChange={10}
      opponentRatingBefore={1300}
      opponentRatingAfter={1290}
      opponentRatingChange={-10}
      coinsDelta={15}
      opponentCoinsDelta={-15}
      onClose={() => {}}
      onRematch={() => {}}
      rematchState={{ status: "available" }}
    />,
  );
  await expect(component.getByTestId("game-result-card")).toHaveAttribute("data-result-variant", "quick");
  await expect(component.getByTestId("score-left")).toBeVisible();
  await expect(component.getByTestId("score-right")).toBeVisible();
  await expect(component.locator("text=Rating")).toBeVisible();
  await expect(component.locator("text=Coins")).toBeVisible();
  await expect(component.locator("text=Doubling Cube")).toBeVisible();
  await expect(component.getByRole("button", { name: /Rematch/i })).toBeVisible();
  const backHomeAction = component
    .getByRole("button")
    .filter({ hasText: "Back to Home" });

  await expect(backHomeAction).toHaveCount(1);
  await expect(backHomeAction).toBeVisible();
});

test("game-result-card has accessible title and close", async ({ mount }) => {
  const component = await mount(
    <PrivateGameResult
      winner="white"
      whiteScore={1}
      blackScore={0}
      whiteName="Alice"
      blackName="Bob"
      playerColor="white"
      cube={1}
      onClose={() => {}}
      onRematch={() => {}}
    />,
  );
  const card = component.getByTestId("game-result-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("aria-labelledby", "game-result-title");
  await expect(component.getByTestId("score-white")).toBeAttached();
  await expect(component.getByTestId("score-black")).toBeAttached();
  // close button accessible
  await expect(card.locator("button").first()).toBeVisible();
});

