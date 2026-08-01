# Complete Tailwind → CSS Modules Migration

Date: 2026-08-02

## Context

The frontend is migrating from Tailwind CSS to CSS Modules (started in commit
`dce3c47`). Every component except two already uses `.module.css` files.

Findings from exploration:

- Only two files still reference Tailwind utility classes: `LobbyPage.tsx` and
  `GameResultOverlay.tsx`.
- `LobbyPage.tsx` is dead code: it is not referenced by the router or any other
  component. The `/home` route renders `HomeScreen`, which supersedes it.
  LobbyPage also calls the outdated API signature `createRoom()` (current code
  uses `createRoom({ targetPoints, preferredColor })`).
- `GameResultOverlay.tsx` mixes dead Tailwind layout classes with inline
  `style={{...}}` values that carry the actual visual design.
- Tailwind is installed (`tailwindcss`, `@tailwindcss/vite`) and wired into
  `vite.config.ts`, but **no CSS file contains `@import "tailwindcss"`**, so
  Tailwind produces zero CSS. All utility classes in the two files are inert.

## Scope

1. Delete `frontend/src/components/LobbyPage/` (folder: `LobbyPage.tsx`,
   `index.ts`).
2. Migrate `GameResultOverlay.tsx` to a new `GameResultOverlay.module.css`:
   - Move dead Tailwind layout classes to semantic class names.
   - Move inline `style={{...}}` presentational values into the CSS module.
   - Keep Motion animation values (opacity/scale/y/spring) in JSX — they are
     animation props, not styles.
   - Dynamic colors driven by state via modifier classes or `data-*` attributes
     (e.g. won/lost title, "You" / "Bot" span colors).
3. Remove Tailwind entirely:
   - `pnpm remove tailwindcss @tailwindcss/vite`
   - Remove the `tailwindcss()` plugin from `frontend/vite.config.ts`.
   - Update `frontend/README.md`: drop Tailwind from the header, the deps table,
     and the Styling section.

## Design

### GameResultOverlay.module.css

Semantic class names that mirror the current JSX structure and the inline style
values:

- `.overlay` — fixed inset overlay, centered flex layout, dark backdrop
  (`rgba(0,0,0,0.7)` stays on the overlay; the backdrop is a plain element, so
  it can live in the module).
- `.card` — flex column, centered, gap, padding, rounded-3xl, gradient
  background, gold-tinted border, drop shadow, `max-width: 90vw`.
- `.emoji` — font-size, margin.
- `.title` — font-size/weight, responsive `sm:` bump; color selected by a
  modifier class (`.titleWon` / `.titleLost`).
- `.label` — label line (white/80).
- `.scoreBox` — full-width, padding, rounded, translucent white background,
  hairline border.
- `.scoreLabel` — small muted label.
- `.scoreRow` — flex, centered, gap; large bold text.
- `.scoreYou` / `.scoreVs` / `.scoreBot` — colors for the three score spans.
- `.actions` — flex row with gap.
- `.button` — base button styling (padding, radius, font).
- `.buttonPrimary` — gold gradient, dark text, hover scale / active scale
  transitions.
- `.buttonSecondary` — translucent background, white text, border, hover/active
  transitions.
- `.hint` — small muted line.

Modifier state:

- `.titleWon` (color `#f4e4c1`) and `.titleLost` (color `#ff6b6b`) — applied
  based on `youWon`.
- `.scoreBotWinner` — applies `#f4e4c1` to the Bot score span when the bot won
  the match; otherwise white. Kept as a simple conditional class.

`data-*` attributes are avoided in favor of explicit modifier classes since the
state is already computed (`youWon`, `isMatchOver`, `matchWinner`).

### No visual change

The migration is 1:1. All color/background/border/spacing values currently in
inline styles and Tailwind classes are reproduced exactly in the CSS module.
The rendered appearance must not change.

## Out of scope

- `HomeScreen` and all other components (already migrated).
- The backend.
- Motion/animation behavior.

## Verification

- `cd frontend && pnpm build` succeeds with no type errors.
- `pnpm lint`/typecheck if present.
- Grep confirms no Tailwind classes remain: `className="[^"]*[a-z]-[a-z]"` in
  `src/**/*.tsx` returns only CSS-module references.
- Grep confirms no `@import "tailwindcss"`, `@tailwind`, or `@theme` directives.
- Manual check of the result overlay (local bot match) for visual parity.
