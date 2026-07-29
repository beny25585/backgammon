# UI Guidelines

## Visual Direction

- The app should feel warm, elegant, and game-focused.
- Use deep greens, parchment surfaces, and gold accents.
- Prefer layered backgrounds over flat fills.
- Keep decorative motion subtle and purposeful.

## Typography

- Use `Playfair Display` for large headlines and key callouts.
- Use `Assistant` for body text, buttons, forms, and labels.
- Headlines should be expressive; body text should stay clear and compact.

## Layout

- Each screen should have a single clear primary action.
- Content screens should use cards, panels, and consistent spacing.
- Large decorative heroes are for showcase pages only.
- Functional screens should stay calm and readable.

## Responsiveness

- The app must work cleanly on mobile, tablet, and desktop.
- Design mobile-first when adding new layout rules.
- Prefer stacking content vertically on narrow screens instead of shrinking it too much.
- Keep tap targets large enough for touch, especially buttons and tabs.
- Avoid fixed widths for key containers unless there is a mobile fallback.
- Reduce decoration and side-by-side layouts when the screen gets narrow.
- Test the main flows on small screens: auth, home, waiting room, match settings, and gameplay.

## Shared Components

- `PageShell` for full-screen framing and background treatment.
- `SectionCard` for reusable content blocks.
- `PrimaryButton` and `SecondaryButton` for consistent actions.
- `StatusBadge` for states such as waiting, active, or completed.

## Screen Rules

- `HomeScreen`: the strongest visual expression of the brand.
- `AuthScreen`: welcoming, focused, and conversion-friendly.
- `WaitingRoom`: status-first, minimal, and easy to scan.
- `MatchHistory` and `MatchDetail`: simple, structured, and content-led.
- `GameScreen`: functional first, with the least decoration.

## Do

- Reuse the same colors, spacing, and button styles.
- Keep responsive behavior simple and predictable.
- Use motion to support state changes, not to distract.
- Make sure every new component has a mobile behavior, not just a desktop one.

## Don't

- Create a new visual language for every page.
- Mix too many font families or button styles.
- Put heavy decoration on gameplay screens.
- Leave controls clipped, tiny, or overlapping on smaller screens.
