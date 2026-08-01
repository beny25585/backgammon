# Complete Tailwind → CSS Modules Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Tailwind → CSS Modules migration by converting `GameResultOverlay`, deleting the dead `LobbyPage`, and removing Tailwind from the project entirely.

**Architecture:** The frontend already uses CSS Modules (`.module.css`) for every component except `GameResultOverlay` and the dead `LobbyPage`. This plan converts the last live component to a CSS module (1:1 visual parity), deletes dead code, and strips the inert Tailwind setup (`tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`) plus its README mentions.

**Tech Stack:** React 19 + TypeScript + Vite 5 + CSS Modules + Motion (for animation props only). Package manager: pnpm.

---

## File Map

**Delete:**
- `frontend/src/components/LobbyPage/LobbyPage.tsx`
- `frontend/src/components/LobbyPage/index.ts`
- `frontend/src/components/LobbyPage/` (empty dir after files removed)

**Create:**
- `frontend/src/components/GameResultOverlay/GameResultOverlay.module.css`
- `frontend/src/components/GameResultOverlay/GameResultOverlay.test.tsx` (visual test harness)
- `frontend/test-overlay.html` (entry that mounts the harness)

**Modify:**
- `frontend/src/components/GameResultOverlay/GameResultOverlay.tsx`
- `frontend/vite.config.ts:3,12` (remove tailwind import + plugin)
- `frontend/package.json` (deps — handled by `pnpm remove`)
- `frontend/pnpm-lock.yaml` (handled by `pnpm remove`)
- `frontend/README.md` (header line 3, Styling section ~151-160, deps table ~178-179)

---

### Task 1: Delete the dead LobbyPage component

**Files:**
- Delete: `frontend/src/components/LobbyPage/LobbyPage.tsx`
- Delete: `frontend/src/components/LobbyPage/index.ts`

Verified in exploration: `LobbyPage` is referenced only by its own `index.ts`. The router (`frontend/src/router.tsx:70`) renders `HomeScreen` at `/home`, and `frontend/src/components/index.ts` does not export LobbyPage.

- [ ] **Step 1: Delete the component and index files**

```bash
rm "frontend/src/components/LobbyPage/LobbyPage.tsx"
rm "frontend/src/components/LobbyPage/index.ts"
rmdir "frontend/src/components/LobbyPage"
```

- [ ] **Step 2: Verify no references remain**

Run: `grep -rn "LobbyPage" frontend/src`
Expected: no matches.

- [ ] **Step 3: Verify the app still builds**

Run: `cd frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove unused LobbyPage component"
```

---

### Task 2: Create the GameResultOverlay CSS module

**Files:**
- Create: `frontend/src/components/GameResultOverlay/GameResultOverlay.module.css`

This converts every dead Tailwind class and every inline `style={{...}}` value from `GameResultOverlay.tsx` into one CSS module. Values are copied 1:1 — no visual change. Modifier classes handle the two dynamic colors (won/lost title, bot-winner score span). Motion props (`initial`/`animate`/`transition`) stay in JSX.

- [ ] **Step 1: Write `GameResultOverlay.module.css`**

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.7);
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  border-radius: 24px;
  text-align: center;
  background: linear-gradient(135deg, #1a0e06 0%, #2a1810 50%, #1a0e06 100%);
  border: 2px solid rgba(255, 200, 100, 0.3);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  max-width: 90vw;
}

.emoji {
  font-size: 48px;
  margin-bottom: 8px;
}

.title {
  font-size: 24px;
  font-weight: 700;
}

.titleWon {
  color: #f4e4c1;
}

.titleLost {
  color: #ff6b6b;
}

@media (min-width: 640px) {
  .title {
    font-size: 30px;
  }
}

.label {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.8);
}

.scoreBox {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  margin-top: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.scoreLabel {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 4px;
}

.scoreRow {
  display: flex;
  justify-content: center;
  gap: 24px;
  font-size: 18px;
  font-weight: 700;
}

.scoreYou {
  color: #f4e4c1;
}

.scoreVs {
  color: rgba(255, 255, 255, 0.4);
}

.scoreBot {
  color: white;
}

.scoreBotWinner {
  color: #f4e4c1;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.button {
  padding: 10px 24px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  transition:
    transform 0.15s,
    filter 0.15s;
  cursor: pointer;
  border: 0;
}

.button:hover {
  transform: scale(1.05);
}

.button:active {
  transform: scale(0.95);
}

.buttonPrimary {
  background: linear-gradient(135deg, #f4e4c1, #d4b880);
  color: #1a0e06;
}

.buttonSecondary {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/GameResultOverlay/GameResultOverlay.module.css
git commit -m "feat: add GameResultOverlay CSS module"
```

---

### Task 3: Migrate GameResultOverlay.tsx to the CSS module

**Files:**
- Modify: `frontend/src/components/GameResultOverlay/GameResultOverlay.tsx`

Replace all `className` utility strings with `styles.*` references and remove all inline `style={{...}}` props. Motion props remain untouched. Dynamic colors use modifier classes: `titleWon`/`titleLost` based on `youWon`, and `scoreBotWinner` on the Bot span when the bot won the match.

- [ ] **Step 1: Rewrite the component**

Replace the entire file content with:

```tsx
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./GameResultOverlay.module.css";

interface GameResultOverlayProps {
  winner: Color;
  winType: "single" | "gammon" | "backgammon";
  points: number;
  cube: number;
  matchScore: Record<Color, number>;
  matchTarget: number;
  matchWinner: Color | null;
  onNext: () => void;
  onHome: () => void;
}

const winLabels = {
  single: "Wins!",
  gammon: "Gammon! ×2",
  backgammon: "Backgammon! ×3",
};

export default function GameResultOverlay({
  winner,
  winType,
  points,
  cube,
  matchScore,
  matchTarget,
  matchWinner,
  onNext,
  onHome,
}: GameResultOverlayProps) {
  const isMatchOver = matchWinner !== null;
  const youWon = winner === "white";

  function label() {
    const wl = winLabels[winType];
    if (cube > 1) return `${wl} (cube ×${cube}) → +${points}`;
    return `${wl} → +${points}`;
  }

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={styles.card}
        initial={{ scale: 0.8, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
      >
        {isMatchOver && (
          <span className={styles.emoji}>
            {matchWinner === "white" ? "🏆" : "😞"}
          </span>
        )}

        <h2
          className={`${styles.title} ${
            youWon ? styles.titleWon : styles.titleLost
          }`}
        >
          {isMatchOver
            ? matchWinner === "white"
              ? "Match Won!"
              : "Match Lost"
            : youWon
              ? "You Win!"
              : "You Lost"}
        </h2>

        <p className={styles.label}>{label()}</p>

        <div className={styles.scoreBox}>
          <p className={styles.scoreLabel}>
            Match Score (first to {matchTarget})
          </p>
          <div className={styles.scoreRow}>
            <span className={styles.scoreYou}>
              You: {matchScore.white}
            </span>
            <span className={styles.scoreVs}>vs</span>
            <span
              className={
                matchWinner === "white"
                  ? styles.scoreBotWinner
                  : styles.scoreBot
              }
            >
              Bot: {matchScore.black}
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          {!isMatchOver && (
            <button
              onClick={onNext}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              Next Game →
            </button>
          )}
          <button
            onClick={onHome}
            className={`${styles.button} ${styles.buttonSecondary}`}
          >
            {isMatchOver ? "Back to Home" : "Quit Match"}
          </button>
        </div>

        {!isMatchOver && matchTarget > 1 && (
          <p className={styles.hint}>
            Next game starts automatically in 30s
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Build to verify no type errors**

Run: `cd frontend && pnpm build`
Expected: `tsc` passes and `vite build` succeeds.

- [ ] **Step 3: Grep to confirm no inline styles or utility classes remain in this file**

Run: `grep -n 'style={{' frontend/src/components/GameResultOverlay/GameResultOverlay.tsx`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GameResultOverlay/GameResultOverlay.tsx
git commit -m "refactor: migrate GameResultOverlay to CSS module"
```

---

### Task 4: Create a visual test harness for GameResultOverlay

**Files:**
- Create: `frontend/src/components/GameResultOverlay/GameResultOverlay.test.tsx`
- Create: `frontend/test-overlay.html`

Mirrors the existing `frontend/test-board.tsx` + `frontend/test-board.html` pattern
(same lines 1-8 of `test-board.tsx` setup, minus the GameContext wrapper — this
component needs no provider). The test file lives inside the component folder, and
a root-level HTML entry points at it so Vite serves it at `/test-overlay.html`.

- [ ] **Step 1: Write `GameResultOverlay.test.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import GameResultOverlay from "./GameResultOverlay";
import "../../../styles/global.css";
import type { Color } from "@/lib/backgammon/engine";

const winner: Color = "white";

function Test() {
  return (
    <GameResultOverlay
      winner={winner}
      winType="gammon"
      points={4}
      cube={2}
      matchScore={{ white: 3, black: 1 }}
      matchTarget={5}
      matchWinner={null}
      onNext={() => {}}
      onHome={() => {}}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Test />);
```

- [ ] **Step 2: Write `frontend/test-overlay.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>test overlay</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/components/GameResultOverlay/GameResultOverlay.test.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify it renders**

Run: `cd frontend && pnpm dev` then open `http://localhost:5173/test-overlay.html`
Expected: the result overlay card renders — dark backdrop, gradient card with gold
border, "You Win!" title in cream, "Gammon! ×2 → +4" label, match score row
(You 3 / vs / Bot 1), gold "Next Game →" button and translucent "Quit Match" button.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GameResultOverlay/GameResultOverlay.test.tsx frontend/test-overlay.html
git commit -m "test: add visual test harness for GameResultOverlay"
```

---

### Task 5: Remove Tailwind from the build config

**Files:**
- Modify: `frontend/vite.config.ts:3,12`

- [ ] **Step 1: Remove the tailwind import and plugin**

Remove line 3 (`import tailwindcss from "@tailwindcss/vite";`) and change line 12 from
`plugins: [tailwindcss(), react()],` to `plugins: [react()],`.

Resulting file:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = path.resolve(__dirname, "./src");

export default defineConfig({
  base: "/backgammon/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      alias: {
        "@": srcRoot,
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    allowedHosts: ["morphotonemic-compellably-roselee.ngrok-free.dev"],
    proxy: {
      "/backgammon/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backgammon/, ""),
      },
      "/backgammon/ws": {
        target: "ws://localhost:8000",
        ws: true,
        rewrite: (path) => path.replace(/^\/backgammon/, ""),
      },
    },
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

- [ ] **Step 2: Remove the Tailwind packages**

Run: `cd frontend && pnpm remove tailwindcss @tailwindcss/vite tw-animate-css`
Expected: packages removed from `package.json` and `pnpm-lock.yaml`.

- [ ] **Step 3: Verify nothing imports the removed packages**

Run: `grep -rn "tailwind\|tw-animate" frontend/src frontend/vite.config.ts frontend/package.json`
Expected: no matches.

- [ ] **Step 4: Build to verify**

Run: `cd frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: remove unused Tailwind setup"
```

---

### Task 6: Update the README

**Files:**
- Modify: `frontend/README.md`

- [ ] **Step 1: Update the header line 3**

Change:
```md
React 19 + TypeScript + Vite 5 + Tailwind CSS 4 + Motion — the UI layer.
```
To:
```md
React 19 + TypeScript + Vite 5 + Motion — the UI layer.
```

- [ ] **Step 2: Update the Styling section (lines ~151-160)**

Change:
```md
## Styling

- **Tailwind CSS 4** — layout, spacing, typography
- **CSS Modules** (`.module.css`) — component-scoped complex layouts
```
To:
```md
## Styling

- **CSS Modules** (`.module.css`) — component-scoped styles
```

- [ ] **Step 3: Remove Tailwind from the deps table (lines ~178-179)**

Remove these two rows from the Dependencies table:
```md
| `tailwindcss` / `@tailwindcss/vite` | Utility-first CSS |
| `tw-animate-css` | Animation utilities |
```

- [ ] **Step 4: Update the final "Key Patterns" line (~192)**

Change:
```md
- **CSS Modules for scoped styles**, Tailwind for layout/utilities
```
To:
```md
- **CSS Modules for all styling** (one `.module.css` per component)
```

- [ ] **Step 5: Commit**

```bash
git add frontend/README.md
git commit -m "docs: remove Tailwind references from README"
```

---

### Task 7: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Confirm no Tailwind directives or utility classes remain**

Run:
```bash
grep -rn "@import \"tailwindcss\"\|@tailwind\|@theme" frontend/src --include="*.css"
grep -rn 'className="[^"]*[a-z]-[a-z]' frontend/src --include="*.tsx"
```
Expected: no matches in either command.

- [ ] **Step 2: Confirm LobbyPage is gone**

Run: `ls frontend/src/components/LobbyPage`
Expected: `No such file or directory`.

- [ ] **Step 3: Run full build and lint**

Run: `cd frontend && pnpm build && pnpm lint`
Expected: build succeeds, lint passes with no errors.

- [ ] **Step 4: Visual check via the test harness**

Run: `cd frontend && pnpm dev`, open `http://localhost:5173/test-overlay.html`
Expected: the result overlay renders with all elements present (dark backdrop,
gradient card, gold border, won/lost title colors, score row, gold "Next Game"
button, translucent "Quit Match" button).
