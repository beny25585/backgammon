# Backgammon — Online Multiplayer & AI

A real-time Backgammon game with online multiplayer (WebSocket), local AI opponent, match scoring, and full rules including the doubling cube.

```
Frontend:  React 19 + TypeScript + Vite + Tailwind CSS 4 + CSS Modules + Motion  →  :5173
Backend:   Django 5 + Channels 4 + Daphne + SimpleJWT + SQLite     →  :8000
```

---

## Quick Start

```bash
# Terminal 1 — Backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Linux/WSL
# source .venv/Scripts/activate    # Git Bash
pip install -r requirements.txt && python manage.py migrate
python manage.py runserver 8000

# Terminal 2 — Frontend
cd frontend
pnpm install && pnpm dev          # → http://localhost:5173
```

---

## Play vs AI (no backend needed)

Click **🤖 Play vs AI** on the home screen, configure match settings, and play against a 1-ply heuristic bot. The game runs entirely client-side — no server needed.

---

## Architecture

```
Client Action  ──WebSocket──►  Django Consumer  ──►  Game Engine (validate + apply)
                                   │                       │
                                   │                  State Update
                                   │                       │
                                   ◄────── Broadcast to room ──────►
                                                                  All Clients
```

**Server-authoritative** for multiplayer — the server validates every move.
**Client-side engine** for AI/local mode — same pure logic, no server required.

---

## CSS Module Migration

All component styles use CSS Modules with the project's [CSS custom properties](frontend/src/styles/global.css) (`--checker-white`, `--checker-black`, `--gold`, etc.) for the board theme palette.

| Component | CSS Module | Status |
|-----------|-----------|--------|
| `MatchSettings` | `MatchSettings.module.css` | Converted from Tailwind + inline styles |
| `Dice` | `Dice.module.css` | Converted from Tailwind + inline styles |
| `GameScreen` | `GameScreen.module.css` | Overlay classes added |
| `Controls` | `Controls.module.css` | Cleaned up unused sections |
| `DoublingCube` | `DoublingCube.module.css` | Redesigned — compact vertical layout |
| `Board` (pieces) | `*Piece*.module.css` | Existing modules, imported |
| `HomeScreen`, `AuthScreen`, `WaitingRoom` | `*.module.css` | Already using CSS Modules |

Motion animation props (`initial`, `animate`, `transition`, `whileHover`, `whileTap`) stay inline. Only static styling (layout, colors, gradients, borders, shadows) lives in CSS. Dynamic values (pip positions, 3D transforms, `backfaceVisibility`) remain inline.

---

## Project Structure

```
Backgammon Game/
├── README.md                     ← This file
├── .gitignore                    # Root gitignore
├── CODE_REVIEW.md                # Best-practices code review
├── TODO.md                       # Roadmap with Backgammon Galaxy comparison
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board/            # Board frame + pieces (points, checkers, bar, bear-off)
│   │   │   ├── Dice/             # 3D rolling cube animation + dice display (CSS Module)
│   │   │   ├── GameScreen/       # Game container + board overlays (CSS Module)
│   │   │   ├── HomeScreen/       # Room creation, match settings, active rooms (CSS Module)
│   │   │   ├── WaitingRoom/      # Room code, copy, wait for opponent (CSS Module)
│   │   │   ├── AuthScreen/       # Login / Register (CSS Module)
│   │   │   ├── Controls/         # Double, double-response prompts (CSS Module)
│   │   │   ├── MatchSettings/    # Pre-game config: color, target points (CSS Module)
│   │   │   ├── GameResultOverlay/ # Post-game result + match score + auto-advance
│   │   │   ├── DoublingCube/     # Compact cube face + owner label (CSS Module)
│   │   │   ├── OpponentBar/      # Opponent info + WINNER badge (CSS Module)
│   │   │   └── TurnIndicator/    # Current turn display (CSS Module)
│   │   ├── services/
│   │   │   ├── gameContext.tsx    # WebSocket game state provider
│   │   │   ├── localGameContext.tsx  # Local + AI game state + match scoring
│   │   │   ├── socket.ts         # WebSocket singleton with reconnect
│   │   │   ├── auth.ts           # JWT storage + helpers
│   │   │   ├── api.ts            # REST API client
│   │   │   └── roomStorage.ts    # localStorage room tracking + rejoin
│   │   ├── lib/
│   │   │   ├── backgammon/
│   │   │   │   └── engine.ts     # Pure TypeScript engine (BAR, OFF constants)
│   │   │   └── bot/
│   │   │       ├── evaluate.ts   # Position scoring (pip count, blot exposure, structure)
│   │   │       └── chooseMove.ts  # 1-ply best-move search (adapted from MIT)
│   │   ├── router.tsx            # React Router with auth guards
│   │   ├── types/
│   │   │   ├── game.ts           # GameState, Color, Move, GameMessage types
│   │   │   └── context.ts        # GameContextType, OpeningRollResult
│   │   └── styles/global.css     # CSS variables, fonts, dark theme
│   └── ...
│
└── backend/
    ├── backgammon_project/        # Django settings, ASGI, URLs
    ├── game/
    │   ├── engine.py             # Pure Python game engine
    │   ├── consumers.py          # WebSocket handlers
    │   ├── models.py             # GameRoom + GameState (DB)
    │   ├── views.py              # REST endpoints
    │   └── serializers.py        # DRF serializers
    └── ...
```

---

## Features

| Feature | Multiplayer (WebSocket) | Local / AI |
|---------|------------------------|------------|
| Full rules engine | ✅ Server-authoritative | ✅ Client-side |
| Bot opponent | ❌ | ✅ 1-ply heuristic |
| Match scoring (first to N) | ⚠️ Backend tracks scores | ✅ Fully wired |
| Game result overlay | ❌ | ✅ + auto-advance |
| 3D rolling dice | ✅ | ✅ |
| Doubling cube | ✅ | ✅ |
| Room codes + waiting | ✅ | N/A |
| Reconnection | ✅ (5 retries, 2s linear) | N/A |
| Local storage rejoin | ✅ | N/A |
| Opening roll | ✅ | ✅ |
| Bear-off, bar, blot capture | ✅ | ✅ |

---

## Routing

| Route | Component | Auth |
|-------|-----------|------|
| `/` | AuthScreen | Redirect to `/home` if logged in |
| `/home` | HomeScreen | Required |
| `/waiting/:roomId` | WaitingRoom | Required |
| `/game/:roomId?color=` | GameProvider + GameScreen | Required |
| `/local?bot=&target=` | LocalGameProvider + GameScreen | None |

Powered by `react-router-dom` v6 with `RequireAuth` and `RedirectIfAuthed` guards.

---

## Key Design Decisions

- **Pure engine**: Frontend and backend engines are independent implementations of the same rules. No shared code, no drift.
- **Named constants**: `BAR` / `OFF` instead of string literals. `Source` / `Target` types instead of `number | "bar"`.
- **3D dice**: Six-face CSS cube with `preserve-3d`, `rotateX/Y/Z` animation, `backfaceVisibility: hidden`. Rolling animation uses 1.2s ease-out via motion's `onAnimationComplete` (no setTimeout).
- **Dice on board**: In-play dice display renders as an overlay centered on the board felt, not in the side panel. Doubling cube shows compactly with owner label.
- **Opening roll sequence**: Player rolls first (2.2s to see result), then bot auto-rolls, winner announced for 4.5s before game starts.
- **Bot AI**: Adapted from [backgammon-baddie](https://github.com/devensimonson/backgammon-baddie) (MIT). 1-ply search with heuristic evaluation (pip count, blot exposure, structure).
- **Match system**: After each game, points are scored (single/gammon/backgammon × cube). Next game auto-advances after 30s or on click. Match ends when target reached.
- **CSS Modules + CSS custom properties**: Components use CSS Modules with `var(--checker-white)`, `var(--checker-black)`, `var(--gold)` theme variables from `global.css`. Tailwind v4 powers the `@theme` block.

---

## Commands

```bash
# Frontend
pnpm dev         # Dev server (:5173, HMR)
pnpm build       # TypeScript check + production build
pnpm preview     # Serve production build

# Backend
python manage.py runserver       # Dev server (:8000, auto-reload)
python manage.py test            # Tests
daphne -b 0.0.0.0 -p 8000 backgammon_project.asgi:application  # ASGI server
```

---

## Production

- PostgreSQL instead of SQLite
- Redis for channel layers (`channels_redis`)
- Daphne / uvicorn behind nginx/Caddy
- HTTPS/WSS via reverse proxy
- `VITE_SERVER_URL=wss://yourdomain.com`
- `DEBUG=False`, secure `SECRET_KEY`

---

## License

MIT (bot AI adapted from [backgammon-baddie](https://github.com/devensimonson/backgammon-baddie), also MIT)
