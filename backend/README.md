# Backgammon — Backend

Django 5 + Channels 4 + Daphne + SimpleJWT + SQLite — authoritative game server.

---

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Linux/WSL
# source .venv/Scripts/activate  # Git Bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

Or with Daphne (proper WebSocket):
```bash
daphne -b 0.0.0.0 -p 8000 backgammon_project.asgi:application
```

---

## Project Structure

```
backend/
├── manage.py
├── requirements.txt
├── backgammon_project/
│   ├── settings.py          # DB, CORS, Channels, JWT
│   ├── urls.py              # /api/ → game.urls
│   ├── asgi.py              # ASGI for Channels
│   └── wsgi.py              # WSGI fallback
├── game/
│   ├── engine.py            # Pure game logic (BackgammonEngine class)
│   ├── consumers.py         # WebSocket handlers
│   ├── models.py            # GameRoom + GameState
│   ├── views.py             # REST endpoints
│   ├── serializers.py       # DRF serializers
│   ├── routing.py           # WS routing
│   └── tests.py
└── ...
```

---

## REST API

Base URL: `http://localhost:8000/api/`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health/` | No | Server health check |
| POST | `/api/register/` | No | Create user + JWT |
| POST | `/api/login/` | No | Login, returns JWT |
| POST | `/api/rooms/` | JWT | Create room (creator = white) |
| POST | `/api/rooms/join/` | JWT | Join room by code |
| GET | `/api/rooms/<code>/` | JWT | Room details + game state |

---

## WebSocket API

### Connection
```
ws://localhost:8000/ws/game/<room_id>/?token=<jwt>
```
JWT required — connection closes with 4001 without valid token.

### Client → Server

| Type | Payload | When |
|------|---------|------|
| `roll_dice` | `{}` | Opening roll (1 die) or normal roll (2 dice) |
| `move` | `{ from, to }` | Make a move. `to` can be `-1` for bear off |
| `offer_double` | `{}` | Offer doubling cube |
| `respond_double` | `{ accept: bool }` | Accept/decline double |
| `end_turn` | `{}` | Pass turn to opponent |

### Server → Client

| Type | When |
|------|------|
| `state_update` | On connect, after major state changes |
| `opening_roll_result` | After opening roll |
| `dice_rolled` | After standard roll |
| `move_made` | After successful move |
| `double_offered` / `double_response` | Double cube |
| `turn_ended` | Turn passed |
| `game_finished` | Game over |
| `player_joined` / `player_disconnected` | Connection events |
| `error` | Validation error |

---

## Engine (`game/engine.py`)

Pure Python `BackgammonEngine` class matching the TypeScript engine rules.

State: 24-point board (positive=white, negative=black), bar, home, dice, phase, cube, etc.

### Methods
- `get_initial_state()`, `roll_dice()`, `apply_opening_roll(color)`
- `legal_moves_from(from_pt, color)`, `all_legal_moves(color)`
- `make_move(from_pt, to_pt, color)` — capture, bear-off, win check
- `offer_double(color)`, `respond_to_double(accept, color)`
- `end_turn()`, `check_win_condition()`

---

## Known Issues

- `models.py` has `generate_room_code()` function unused — views generate code inline
- `GameRoom.state` JSONField duplicates `GameState.state_data`
- Module-level `_connected_users` dict resets on server restart
- No match-level scoring integration in backend

---

## Tournament link

Lets a player arriving from a tournaments server play a fixture here, and reports the result back
when the game ends. Two independently-keyed channels, in opposite directions:

| Direction | Endpoint | Authenticated by |
|---|---|---|
| tournaments → here | `GET /api/link/enter/?ticket=…` | a signed single-use ticket, verified against `GAMELINK_TICKET_SECRETS` |
| here → tournaments | `POST {tournaments}/api/gamelink/result/` | a detached HMAC-SHA256 over the raw body, keyed with `GAMELINK_RESULT_SECRET` |

Redeeming a ticket seats the player in a room for that fixture — one room per fixture, both seats
in it, opposite colours — and hands the SPA a match-scoped session in the URL **fragment**, which
`/link` strips before doing anything else. **The feature ships disabled:** with `GAMELINK_ENABLED`
off, `api/link/enter/` returns 404 and nothing is ever reported.

### Environment variables

Set in `backend/.env` (gitignored — keep it that way).

| Variable | Required | Meaning |
|---|---|---|
| `GAMELINK_ENABLED` | — | `True` to turn the feature on. Default off. |
| `GAMELINK_TOURNAMENTS_URL` | when enabled | Base URL of the tournaments server, `https://…`, no path. Results are POSTed here. |
| `GAMELINK_FRONTEND_URL` | when enabled | Base URL of this project's SPA, `https://…`. A redeemed ticket redirects to `{FRONTEND}/link`. |
| `GAMELINK_TICKET_SECRETS` | when enabled | Comma-separated list. Verifies inbound tickets; **every** entry is tried, so rotation has no gap. |
| `GAMELINK_RESULT_SECRET` | when enabled | Signs the results this server sends. One value, not a list — this side is the signer. |

Generate each separately, per environment, and never commit one:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`GAMELINK_TICKET_TTL` (120 s) must match the issuer's value; a ticket older than that is refused.
A boot-time system check (`gamelink.E001`–`E006`) refuses to start when the feature is on outside
`DEBUG` with a missing or short secret, one secret shared across both channels, or a base URL that
is not `https://`. Run it with `python manage.py check`.

### Scheduled jobs

```cron
* * * * * cd /srv/backgammon/backend && ./.venv/bin/python manage.py run_tasks
0 * * * * cd /srv/backgammon/backend && ./.venv/bin/python manage.py purge_redeemed_tickets
```

**`run_tasks` is required, not a nicety.** Reporting a result is a transactional outbox: the delivery
row is written inside the transaction that records the `Match`, and `transaction.on_commit` makes
one immediate best-effort attempt. That attempt swallows its own failure by design, so if the
tournaments server is down for thirty seconds and nothing runs `run_tasks`, the match result is
lost permanently and silently. With it scheduled, a refused delivery is retried about five minutes
after the first failure and about ten after the second; the third failure marks the task `failed`
and nothing touches it again.

**Nothing alerts on a `failed` task.** The admin's `Task` list is the dead-letter view — filter it
to `status = failed` and read the `error` column, which carries the exception that stopped the
delivery. Everything there is read-only: a queue row records what the server tried to do, and
editing one would either forge that record or re-arm a delivery by hand.

`purge_redeemed_tickets` deletes spent-ticket rows that are past their own expiry. That is safe
precisely because an expired ticket is refused by the verifier — twice, by the signature age and by
the `exp` claim — before redemption is ever considered, so the row is protecting nothing by then.

### Rotating a secret

Each verifier takes a **list** and each signer uses the **first** entry, so a rotation never has a
window where valid messages bounce. To rotate the ticket secret, whose signer is the tournaments
server:

1. Append the new secret to `GAMELINK_TICKET_SECRETS` here and deploy. Both old and new now verify.
2. Switch the tournaments server's `GAMELINK_TICKET_SECRET` to the new value and deploy there.
3. Remove the old secret from the list here and deploy.

The result secret rotates the same way in the other direction: add the new value to the tournaments
server's `GAMELINK_RESULT_SECRETS` list first, then change `GAMELINK_RESULT_SECRET` here, then drop
the old one from their list. Never reorder those steps — doing 2 before 1 is exactly the window in
which valid messages are rejected.

### Enabling it

Enable **this side first**. It can only accept tickets nobody is yet able to mint, so it is inert on
its own until the tournaments server is switched on too.
