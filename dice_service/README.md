# Backgammon — Dice Service

Elixir + Plug/Cowboy HTTP service that is the **single source of dice values** for online
games. It wraps the vendored `dice_roller` library, which uses `:crypto.strong_rand_bytes/1`
for cryptographically secure randomness. Django talks to it through `backend/game/dice.py`
(never call it directly from the browser).

---

## Requirements

- Erlang 26.2.5
- Elixir 1.17.3

(see `.tool-versions` — `asdf install` will provision these if you use asdf)

## Run

```bash
cd dice_service
mix deps.get        # first time only
mix run --no-halt   # starts the server and stays running
```

The server binds to `127.0.0.1` on port **4000** by default (localhost only — it's
internal). Override the port with `PORT`:

```bash
PORT=4100 mix run --no-halt
```

## Endpoints

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/health` | `{"status":"ok"}` |
| GET | `/roll?type=normal` | `{"dice":[a,b]}` — doubles allowed |
| GET | `/roll?type=opening` | `{"dice":[a,b]}` — `a != b`, no doubles |
| GET | `/roll` | `{"dice":[a,b]}` — defaults to `normal` |

Every request is logged as `[dice] METHOD path?query -> status (duration)`.

### Smoke test

```bash
curl http://127.0.0.1:4000/health
curl "http://127.0.0.1:4000/roll?type=normal"   # -> {"dice":[3,5]}
curl "http://127.0.0.1:4000/roll?type=opening"  # -> {"dice":[4,1]}  (never doubles)
```

## Integration with Django

The Django backend proxies rolls through this service:

- `DICE_SERVICE_URL` env var in `backend/.env` points at it (default `http://127.0.0.1:4000`).
- `backend/game/dice.py` is the strict HTTP client — if the service is unreachable it raises
  `DiceServiceError` rather than falling back to local randomness, so a broken dice service is
  always visible.
- Roll intents sent over the WebSocket (`{action:"roll"}`) are resolved server-side by the
  Django consumer using dice from this service; the frontend never generates dice.
- `GET /api/dice/roll/` and `GET /api/dice/health/` on Django are proxies for testing/debugging.

> Make sure this service is running **before** starting an online game — otherwise rolls fail
> with a `Dice service error`.

## Test

```bash
cd dice_service
mix test
```

## Layout

```
dice_service/
├── lib/
│   ├── dice_service.ex        # maps :opening/:normal to the roller flag
│   ├── dice_service/
│   │   ├── application.ex     # boots Plug.Cowboy (port from PORT, default 4000)
│   │   └── router.ex          # /health + /roll endpoints
│   └── dice_roller/           # vendored dice_roller library (CryptoRandom default)
├── config/
├── test/
├── mix.exs
└── .tool-versions
```
