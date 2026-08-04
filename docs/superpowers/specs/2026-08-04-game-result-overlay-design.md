# Game-Result Overlay Redesign — Design

Date: 2026-08-04
Status: Approved design

## Goal

Rework the game-result overlay (`GameResultOverlay.tsx`) so it:
1. Uses the approved **"Casino felt"** visual style (green felt + gold trim).
2. Shows **one** overlay only, with correct, non-overlapping layout.
3. Displays **real usernames** in a stacked-row scoreboard (name left, score right) — no hardcoded "You"/"Bot".
4. **Animated count-up** on the winning player's score.
5. Shows the **correct message to each player** — including player B (the loser) getting their own loss view.

## Current State

`GameResultOverlay.tsx` is rendered once inside `GameContext.Provider` by both `gameContext.tsx` (online) and `localGameContext.tsx` (local / vs AI). Problems:

| Problem | Where | Detail |
|---|---|---|
| Online always looks "match over" | `gameContext.tsx:517` | passes `matchWinner={gameResult.winner}` — so `isMatchOver` is always true for online games. "Next Game → / Quit Match" never appears online, and online match-over detection is wrong. |
| Hardcoded "You:" / "Bot:" labels | `GameResultOverlay.tsx:87-99` | Overlay ignores `whiteName`/`blackName` from context; score row always reads "You: X vs Bot: Y" even for real-vs-real online play. |
| No count-up animation | `GameResultOverlay.tsx` | Score is static text; the winner's score does not animate/increment. |
| Player B message unverified | — | No test asserts the loser (player B) sees the correct loss view; user reports they saw no result at all. |
| Old visuals stacked/overlapping | CSS | Prior versions rendered two overlapping result blocks; the new single overlay must not regress this. |

## Approach

Single overlay, styled "Casino felt", with the scoreboard driven by context usernames and a count-up on the winner.

### Visual style — "Casino felt" (Option D)

- Backdrop: dim scrim over the board.
- Card: green felt radial gradient (`#1f4d38 → #123527`), thick gold border (`#d8b25c`, ~4px), inner dashed gold frame, rounded corners, heavy drop shadow.
- Title: gold-cream serif (`Playfair Display`), e.g. **"You Win!"**, **"Match Lost"**.
- Win-type line below title carries the points info (e.g. **"Gammon! ×2"**, **"Backgammon! ×3"**) — the old "Wins! → +1" subtitle is removed, and **no "+N" chip**.
- Scoreboard: two **stacked rows** (not columns). Each row: player name (left) + score (right). Winner's row glows gold; loser's row neutral.
  - Online: real usernames from `whiteName`/`blackName`.
  - Local / vs AI: opponent shows **"Bot"** (no real username exists); human side shows username if available, else "You".
- Buttons: pill buttons — gold gradient primary ("Next Game →" / "Back to Home") and ghost outline secondary ("Quit Match").

### Score logic

- `isMatchOver` is **derived**, not passed: `matchScore[winner] >= matchTarget`. This works identically for online and local contexts, fixing the `matchWinner={gameResult.winner}` bug.
  - Both render sites (`gameContext.tsx`, `localGameContext.tsx`) stop passing `matchWinner` (pass `null`). The component derives `matchWinner = matchScore[winner] >= matchTarget ? winner : null`; the prop is kept only for backward-compat with existing tests.
- Match-over view: title "Match Won!" / "Match Lost", single "Back to Home" button.
- Between games (not match-over): "Next Game →" + "Quit Match", plus the auto-advance note (kept from current).

### Count-up animation

- On mount, the winner's displayed score animates from `matchScore[winner] - points` up to `matchScore[winner]` (the point(s) just won). Other score renders at its final value.
- Implement as a small local hook (`useCountUp`) using `requestAnimationFrame` or `motion` — matches existing `motion` usage in the project. Duration ~600–800ms, ease-out.

### Single overlay guarantee

- `GameResultOverlay` stays rendered exactly once per provider. Remove any duplicate/legacy inline result markup so only the one overlay exists. The `.backdrop` covers the viewport (`position: fixed; inset: 0`), so a single overlay is a full-screen modal.

## Data flow

- Both providers already expose `whiteName`/`blackName` via context (`GameContextType`). `GameResultOverlay` will receive them as props from both render sites (`gameContext.tsx`, `localGameContext.tsx`).
- `gameResult.points` already exists on both paths (online: `payload.points`; local: computed from win type × cube) and is used for the count-up start value.
- Online `targetPoints` comes from `payload.targetPoints` (already plumbed); local uses `MATCH_TARGET`.

## Error handling

- If a username is null (local mode, or names not yet received online), fall back: opponent → "Bot" (local) / "Opponent" (online), self → "You".
- If `matchScore` is missing a color, default to 0.

## Testing

Update `GameResultOverlay.test.tsx` (Playwright CT, mounts `LocalGameProvider` + `GameOverProbe`) and add:

1. **Player B (loser) gets the correct view** — mount with `playerColor` = losing color; assert "You Lost" / "Match Lost" title, correct winner row highlighted, and the loser's username shown.
2. **Usernames replace "You"/"Bot"** — `LocalGameProvider` + a context stub with `whiteName`/`blackName`; assert both names render in the scoreboard rows, and "Bot:" / "You:" tokens do not appear.
3. **Count-up animation** — assert the winner's score starts below the final value (or that `useCountUp` reaches the target) using a mocked clock.
4. **Online match-over detection** — mount the overlay directly (not via provider) with `matchScore[winner] >= matchTarget`; assert "Match Won!" + "Back to Home" appear and "Next Game →" does not; and the inverse for a mid-match win.
5. Keep existing tests passing (single overlay, match-over at target, countdown, side-panel score sync).

## Out of scope

- Backend changes (game-end flow already centralized; the overlay consumes existing payloads).
- The active-room desync fix (separate concern, already addressed via `GET /api/rooms/active/`).
