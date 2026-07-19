# Backgammon Galaxy — Feature Roadmap

**Reference:** [Backgammon Galaxy](https://www.backgammongalaxy.com/)
**Status:** MVP Phase 1 (basic room flow + game engine working in local mode)

---

## Comparison: Current vs Galaxy

| Feature | Galaxy | Current | Priority |
|---------|--------|---------|----------|
| Board rendering | Dark theme, SVG, smooth motion | ✅ Built (dark wood, spring animations) | - |
| Game engine | Full rules, doubling cube | ✅ Built (both frontend + backend) | - |
| Local play / Practice vs AI | Play vs AI (multiple levels) | ⚠️ LocalGameProvider (vs self only) | **High** |
| Real-time PvP | WebSocket-based | ✅ Built (Django Channels) | - |
| Auth system | Google + email | ✅ Built (JWT register/login) | - |
| Room codes / Play a Friend | 6-char, shareable code | ✅ Built (auto-generated, copy) | - |
| Single Game | One-off match | ⚠️ Partial (match scoring not wired) | **High** |
| Match Play | Play to N points | ⚠️ `target_points` in model, not wired | **High** |
| Tournaments | Brackets, schedules (BGWC, UBC) | ❌ Missing | Future |
| Lobby | Find active games, matchmaking | ❌ Missing | **Medium** |
| Profile / Stats | Personal statistics | ❌ Missing | **Medium** |
| Rankings / Leaderboards | Global ELO rankings with titles | ❌ Missing | **Medium** |
| Rating system | Glicko/Elo with tier titles | ❌ Missing | **Medium** |
| Analysis | Post-game move review with engine | ❌ Missing | Future |
| Blunders | Identify mistakes after game | ❌ Missing | Future |
| Lessons | Interactive tutorials | ❌ Missing | Future |
| Game clock | Fischer/Bronstein delay | ❌ Missing | **Medium** |
| Replay | Review past moves step-by-step | ❌ Missing | Future |
| Social / Chat | Friends list, in-game chat | ❌ Missing | Low |
| Sound effects | Dice roll, checker move | ❌ Missing | Low |
| Drag-to-move | Drag checkers with snap | ❌ Missing | **Medium** |
| Undo move | In casual games vs AI | ❌ Missing | Low |
| Spectator mode | Watch live games | ❌ Missing | Low |
| Customization | Boards, avatars, themes | ❌ Missing | Low |
| Fair Dice | Verifiable randomness | ❌ Missing | Future |
| Mobile app | iOS + Android (PWA) | ❌ Missing | Future |
| Blog / Learn | Strategy articles, guides | ❌ Missing (docs exist) | Low |
| Multi-language | EN, ES, DE, FR, JA, TR | ❌ Missing (Hebrew-only messages in engine) | Low |

---

## TODO — Bug Fixes (Urgent)

- [ ] **HIGH** — Backend `get_initial_state()` returns empty board (zero checkers). Add initial checker positions matching the frontend `initialBoard()`.
- [ ] **HIGH** — Backend `roll_dice()` doesn't clear `self.state['dice']` on auto-skip. Port the frontend fix (`s.dice = []` in `applyRoll`).
- [ ] **MEDIUM** — `GameRoom.state` and `GameState.state_data` are redundant. Pick one (recommend: remove `Room.state`).
- [ ] **MEDIUM** — Race condition on `join_room`: use `select_for_update()` or atomic transaction.
- [ ] **LOW** — `generate_room_code()` in `models.py` is dead code. Remove.
- [ ] **LOW** — `RegisterSerializer` should validate `password == password2`.
- [ ] **LOW** — `GameMessage` type missing 5 event types.
- [ ] **LOW** — Opening roll `setOpeningRollResult` called during render (violates React rules).
- [ ] **LOW** — `handleRoomJoined` loses `roomCode` — store it.

---

## TODO — Phase 2: Match & Identity

- [ ] **Match scoring** — wire `GameRoom.white_score` / `black_score` into the engine. After a game ends, update scores, check if target reached, offer rematch.
- [ ] **Winner modal** — animated overlay showing winner, win type, match score, "Play Again" / "Back to Lobby" buttons.
- [ ] **Player reconnection** — when reconnecting, restore the player's color and game state from the server. Currently the connection re-sends `state_update` but `playerColor` might not persist after refresh.
- [ ] **Persistent identity** — store a player UUID, allow returning to the same game after browser close.
- [ ] **Turn notification** — when reconnecting to a game in progress, highlight if it's your turn.
- [ ] **Black perspective** — when playing as black, flip the board so your home is at the bottom.
- [ ] **Board labels** — point numbers, home/bar/bear-off labels for clarity.

---

## TODO — Phase 3: Galaxy Parity

- [ ] **AI opponent** — implement a simple AI (greedy: maximize captures, minimize blots). Start with random → heuristic → minimax (depth 1-2). Backend or WebAssembly.
- [ ] **Match history** — store completed games. Show list of past matches with outcome, date, opponent. REST API: `GET /api/matches/`.
- [ ] **Game clock** — Fischer or Bronstein delay. Add `time_left` to game state. Server ticks countdown. Auto-resign on timeout.
- [ ] **Drag-to-move** — enable `drag` on Checker component. On `onDragEnd`, use `document.elementFromPoint()` to find the target point. Snap back if invalid.
- [ ] **Sound effects** — Web Audio API for dice roll, checker movement, capture, win. No external files needed (synthetic sounds).
- [ ] **Rating system** — Glicko-2 or simple ELO. Store rating in User profile. Update after each match.

---

## TODO — Phase 4: Polish & Production

- [ ] **Animations** — checker slide arc (not just linear), dice spin+bounce, capture pop+shake, winner fade-in with confetti.
- [ ] **Error boundaries** — wrap game tree in React error boundary. Show "Something went wrong" with reload button.
- [ ] **Loading states** — skeleton loaders for auth, room list, board (instead of just text).
- [ ] **Responsive** — test on mobile widths. Board already uses `clamp()` sizing but opponent bar and controls may overflow.
- [ ] **Production backend** — PostgreSQL, Redis channel layer, HTTPS/WSS, Daphne behind nginx.
- [ ] **CORS hardening** — remove `'*'` from `ALLOWED_HOSTS`, tighten CORS origins.
- [ ] **Rate limiting** — `django-ratelimit` on register, login, room creation.

---

## TODO — Phase 5: Tests

- [ ] **Frontend engine tests** — `vitest` on `engine.ts`. Cover: move generation, bearing off, captures, doubling, opening roll, win conditions. The engine is pure — trivially testable.
- [ ] **Backend engine tests** — `pytest` on `engine.py`. Same coverage as frontend.
- [ ] **Backend API tests** — test register, login, create room, join room, room detail.
- [ ] **WebSocket consumer tests** — test connect, roll dice, make move, disconnect/reconnect.
- [ ] **Component tests** — `vitest` + `@testing-library/react` for critical components (GameScreen, Board, Controls).

---

## Architecture Decisions Log

| Decision | Current | Recommendation |
|----------|---------|---------------|
| State management | React Context + useGame() | Keep for now — fits the app size. If complexity grows, switch to Zustand. |
| Engine location | Duplicated in frontend + backend | Keep — frontend engine is for UX (legal move highlighting), backend is the authority. But they MUST stay in sync. |
| CSS approach | Tailwind + CSS Modules | Good compromise. Tailwind for layout, CSS Modules for game-specific visuals. |
| WebSocket protocol | Raw JSON via Channels | Fine for now. Consider protobuf or msgpack for production to reduce message size. |
| Database | SQLite | Switch to PostgreSQL before any real users. |
| Auth | JWT in localStorage | Switch to httpOnly cookies for production. |
