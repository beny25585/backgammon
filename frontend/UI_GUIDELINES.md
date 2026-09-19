# Game UI — current design conventions

Reviewed: 2026-09-19 against styles and routing, without new browser screenshots.

## Scope and sources

This document covers the React board app. The Vue club and admin have separate component systems and tokens; see [system design](../../docs/UI_DESIGN.he.md). Source of truth: [global.css](src/styles/global.css), component CSS Modules and [router.tsx](src/router.tsx).

## Visual language

- Dark app surfaces, gold actions, wood/felt board treatments and selectable board themes.
- --font-body and --font-display both use Assistant, Heebo, Arial, sans-serif. Playfair Display is a package dependency, not the active global heading font.
- Brand gold is #d4941a, soft gold #e7bd72; board and checker colors have their own variables. Use the existing tokens and theme mechanism rather than duplicating board colors.
- Global radius tokens are 4, 6, 8 and 12px. Component styles may set their own geometry.

## Layout and active screens

GameScreen gives priority to the board, visible dice, clocks, cube offers, confirmation and result state. The document uses a full-height layout with overflow hidden; scrolling content belongs inside its designated panels. Verify short landscape viewports as well as portrait/mobile and desktop. Touch targets, drag destinations and bear-off controls must remain reachable.

WaitingRoom is status-focused. MatchHistory and MatchDetail are data-focused. / and /home redirect to the Vue club; HomeScreen/AuthScreen are retained components, not the live primary navigation. The full analysis library belongs to the club application.

## Component and interaction rules

Reuse the actual shared components found under src/components; do not assume PageShell, SectionCard or StatusBadge APIs exist merely because older guidelines named them. Keep board motion synchronized with accepted state. Visual animation must not authorize a move or delay the next legal input unnecessarily. Preserve focus indication, disabled states, translated labels, reduced-motion behavior and error recovery.

Clock display uses the shared clock logic, including per-turn delay rather than increment. Game-format labels and financial terms must reflect the server contract. Local TypeScript AI and server Open Sage are separate modes and must be described accordingly.

[PWA deployment](PWA_DEPLOYMENT.he.md), [frontend architecture](README.md), [historical performance review](../PERFORMANCE_AUDIT.md).
