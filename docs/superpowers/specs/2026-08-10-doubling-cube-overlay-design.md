# Doubling Cube in the Dice Overlay + Responsive Tests

Date: 2026-08-10

## Problem

1. The doubling cube value/owner currently only appears in the side panel's `Controls`, hidden from view during active play. Players want the cube visible on the board itself while playing.
2. The app has no automated tests verifying the board fits mobile and tablet viewports, even though the CSS uses responsive `clamp()`/`dvh`/`dvw` sizing and the helpers `assertNoHorizontalOverflow`/`assertFillsParent` exist unused in `src/test-utils/viewportChecks.ts`.
3. The 3D spinning animation (`RollingDie`) lives in `src/components/animations/RollingDie/` and is only used for dice. We want to reuse the same animation style for the doubling cube and make it easy for the owner to tweak.

## Approach

- Add the existing `DoublingCube` component to the board's dice overlay (`boardOverlay`), rendered to the right of the dice.
- Show the cube only during the moving phase AND when it's the player's turn, so it signals "your turn — cube context".
- Restyle the cube: always a white 3D cube face, with the value colored per doubling level. Keep an owner label ("You"/"Center").
- Generalize `RollingDie` so it can render either pip faces (dice) or a single value face (cube), and use it for a spin transition on the cube.
- Add an `@animations` alias so imports into the animations folder are stable.
- Add a new responsive test file that mounts the board at mobile/tablet/desktop sizes and asserts no horizontal overflow + proper fit, using the existing viewport helpers.

## Components / Files

### 1. Dice overlay cube — `src/components/GameScreen/GameBoard.tsx`

- Inside the `boardOverlay` div (currently rendered when `state.phase === "moving" && state.remaining.length > 0`), append:

  ```tsx
  {isMyTurn && <DoublingCube value={state.cube} owner={state.cubeOwner} />}
  ```

  `isMyTurn` is already computed as `state.turn === playerColor && state.phase === "moving"` (GameBoard.tsx:38).
- Import `DoublingCube` from `../DoublingCube`.
- The existing `.boardOverlay` flex container (gap, alignment) already provides spacing; dice stay centered and the cube sits to the right.
- `DiceRow` and the cube must not overlap: keep `gap` and check the overlay fits at 375px (covered by the responsive tests).

### 2. Cube styling — `src/components/DoublingCube/DoublingCube.module.css`

- Replace owner-based faces (`neutral`, `white`, `black` gradients) with a single white 3D cube face:

  ```css
  .cubeFace {
    background: linear-gradient(145deg, #ffffff 0%, #e8e8e8 55%, #c9c9c9 100%);
    color: currentColor;
    border: 1px solid rgba(0, 0, 0, 0.18);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
  ```

- Keep `.neutral`/`.white`/`.black` as **color-value** classes instead of owner classes. Map value → color:

  | Cube value | Number color |
  |---|---|
  | 1 (center) | gray `#9ca3af` |
  | 2 | red `#e74c3c` |
  | 4 | blue `#2e86de` |
  | 8 | green `#27ae60` |
  | 16 | orange `#d35400` |
  | 32 | purple `#8e44ad` |
  | 64 | gold `#e7bd72` |

- Owner label: keep the label but show only "You" (when owned by the player) or "Center". The current `ownerLabel` logic ("You"/"Bot") can stay; the cube only renders on the player's turn, so it will read "You".

### 3. Reusable spinning animation — `src/components/animations/RollingDie/`

- Generalize `RollingDie` (RollingDie.tsx) to support a **value face** mode in addition to pip faces:
  - Add optional prop `variant?: "pips" | "value"` (default `"pips"`) and optional `value?: number` + `valueColor?: string`.
  - In `"value"` mode each face renders the doubling value (same number on all faces — an exact spin doesn't matter for a doubling cube), styled with the value color. In `"pips"` mode keep the current pip faces.
  - Keep the existing idle spin / rolling spin animation (rotateX/rotateY/rotateZ keyframes) — reusable as-is for the cube.
- `DoublingCube` renders `RollingDie` in `"value"` mode for a short spin when the cube value changes (a small rolling transition), sized smaller than the roll dice.
- **Comments:** add explanatory comments at the top of `RollingDie.tsx` and inside `DoublingCube.tsx` documenting:
  - How to change spin speed/duration (edit the `transition` object values, e.g. `rotateX duration: 2`).
  - How to change the number of faces / which value each face shows (edit the `<DieFace value={...} />` rows).
  - How to change cube/die size (edit the inline `width`/`height` `clamp()` values).
  - How to change the value colors (edit the map in `DoublingCube.module.css`).

### 4. `@animations` alias — `frontend/vite.config.ts`

- Add `"@animations": path.resolve(__dirname, "./src/components/animations")` alongside the existing `"@"` alias in both `resolve.alias` and `optimizeDeps.rolldownOptions.resolve.alias`.
- No tsconfig path change is required unless imports are added from non-vite code; if needed, mirror the alias in `tsconfig.json` paths.

### 5. Responsive tests — new file `src/components/GameScreen/GameScreen.responsive.test.tsx`

- Import `test`, `expect` from `@playwright/experimental-ct-react`, `GameBoard`, `MockGameWrapper`, `makeGameState`, and the helpers `assertNoHorizontalOverflow`/`assertFillsParent` from `../../test-utils/viewportChecks`.
- Define `VIEWPORTS = [{ name: "mobile", width: 375, height: 812 }, { name: "tablet", width: 768, height: 1024 }, { name: "desktop", width: 1280, height: 800 }]`.
- For each viewport:
  1. `page.setViewportSize(...)`, then mount a `GameBoard` in a moving phase for the player (`turn: "white"`, `dice: [4, 3]`, `remaining: [4, 3]`).
  2. Assert the dice overlay (`dice-overlay`) is visible and contains the cube (`DoublingCube` face value).
  3. `assertNoHorizontalOverflow` on the board frame (`gameFrame`) and on the page/root element.
  4. `assertFillsParent` on the side panel (`sidePanel`).
- Also assert the cube does NOT appear when it's not the player's turn (e.g., `turn: "black"`).

## Data Flow

- No engine changes. `DoublingCube` reads `state.cube` / `state.cubeOwner`, which the engine already maintains (engine.ts:56-58, `offerDouble`, `respondDouble`).
- No backend changes. GameBoard already receives the full `state`.

## Error Handling

- Non-issue: `DoublingCube` is display-only; a malformed owner/value simply renders a fallback gray "1". Guard the value-color map with a default.

## Testing

- Responsive overflow/fit tests as above (new file).
- Existing tests must keep passing: `GameBoard.test.tsx`, `GameScreen.test.tsx`, `DoublingCube` (if any), `RollingDie.test.tsx`.
- Manual: run `pnpm dev`, play a local match, verify the cube appears in the overlay only on your turn and matches the approved white/colored-number style.

## Out of Scope

- Cube interaction in the overlay (offer/accept/decline buttons) stays in the side panel `Controls`.
- No engine or backend changes.
