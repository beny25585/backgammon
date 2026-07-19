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
