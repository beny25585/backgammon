# Side Panel Redesign — "Balanced Two Rows"

Date: 2026-08-02
Status: Approved design

## Goal

Redesign the in-game side panel into two equal compact player rows (you + opponent) with the active player's row visually highlighted, replacing the current single `OpponentBar` + separate `TurnIndicator` layout. Styling and information display are the focus; no game logic changes.

## Current State

The side panel (`SidePanel.tsx`) stacks four sections:

1. `OpponentBar` — opponent name, Off/Bar chips, combined score "X - Y", "First to N" target, checker preview
2. `TurnIndicator` — "YOUR TURN" / "OPPONENT'S TURN" strip
3. `Controls` — DoublingCube + Double button (or accept/decline prompt)
4. `actions` — Give Up / Leave buttons

`OpponentBar` and `TurnIndicator` are only used by `SidePanel`. `Controls` and `DoublingCube` are shared.

## New Layout

```
┌───────────────────────────────┐
│ [white avatar] White Player    │
│   Off 5  Bar 1             2  │  ← opponent row (idle)
├───────────────────────────────┤
│ [black avatar] You (Black)     │
│   Off 8                      3 │  ← your row (ACTIVE: green glow,
│        "YOUR TURN" label)      │
├───────────────────────────────┤
│ [cube 2] Your cube  [✕2 Double]│
├───────────────────────────────┤
│      [ Give Up ]  [ Leave ]    │
└───────────────────────────────┘
```

- Two equal `PlayerRow`s. Opponent row on top, your row below (matching board orientation: your checkers at the bottom).
- The active player's row gets a glow + tinted border:
  - your turn → green glow, score turns green, small "YOUR TURN" label
  - opponent's turn → gold glow, small "THEIR TURN" label
  - inactive row is dimmed (lower-opacity name/score)
- No separate turn strip.
- The turn badge is a small uppercase label beside the score, not a full-width bar.

## Components

### New: `PlayerRow` (`frontend/src/components/PlayerRow/`)

Props:
- `color: Color` — which player this row represents
- `state: GameState`
- `label: string` — display name ("You (Black)", "White Player", etc.)
- `active: boolean` — is it this player's turn

Renders: color avatar dot, name, `Off: n` and `Bar: n` chips (bar chip only when > 0), score number, and when `active`, the "YOUR TURN" / "THEIR TURN" badge + glow classes.

Score derivation: reuse the existing fallback lookup from `OpponentBar` (`whiteScore`/`white_score` etc.). Per-row score shows only that player's score (e.g. `2` for opponent, `3` for you), not "2 - 3". The "First to N" target line is not displayed in the new layout (removed with `OpponentBar`).

### Modified: `SidePanel`

- Renders `PlayerRow` for opponent (`label="White Player"`, `active={state.turn === opponentColor}`), then `PlayerRow` for you (`label="You (Black)"`, `active={state.turn === playerColor}`).
- Keeps `Controls` and the Give Up / Leave actions unchanged.
- Removes `OpponentBar` and `TurnIndicator` imports/usage.

### Removed

- `frontend/src/components/TurnIndicator/` (tsx, css, index)
- `frontend/src/components/OpponentBar/` (tsx, css, index)
- Remove any exports referencing them in `frontend/src/components/index.ts`.

## Styling

- `SidePanel.module.css` panel container unchanged (padding, bg, border, scroll).
- Player row: horizontal flex, avatar dot, chips, score. Similar visual language to current `OpponentBar` (rounded 12px, subtle border).
- Active styles:
  - `.activeSelf`: `rgba(124, 214, 154, 0.08)` bg, `rgba(124, 214, 154, 0.5)` border, soft glow `box-shadow`.
  - `.activeOpponent`: `rgba(231, 189, 114, 0.12)` bg, `rgba(231, 189, 114, 0.55)` border, soft glow.
- Inactive row: `rgba(255, 255, 255, 0.03)` bg, dimmed text.
- Score: `#e7bd72` (gold) normally, `#7cd69a` (green) when your row is active.
- Touch targets: rows are informational (no click); buttons remain 44px.

## Responsive

- Existing mobile portrait breakpoint (`@media (max-width: 767px)` in panel + GameScreen): panel stacks below board. Player rows should wrap chips rather than overflow; keep the flex row layout, allow wrap on the chip group.

## Files Touched

- `frontend/src/components/PlayerRow/PlayerRow.tsx` (new)
- `frontend/src/components/PlayerRow/PlayerRow.module.css` (new)
- `frontend/src/components/PlayerRow/index.ts` (new)
- `frontend/src/components/SidePanel/SidePanel.tsx` (edit)
- `frontend/src/components/SidePanel/SidePanel.module.css` (edit)
- `frontend/src/components/TurnIndicator/` (delete)
- `frontend/src/components/OpponentBar/` (delete)
- `frontend/src/components/index.ts` (edit, remove deleted exports)

## Non-Goals

- No pip count (not available in `GameState`).
- No engine/backend changes.
- No changes to `Controls`, `DoublingCube`, or the Give Up / Leave flow.
