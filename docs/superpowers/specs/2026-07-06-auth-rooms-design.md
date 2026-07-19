# Auth & Room System Design

## Overview

Add user authentication (JWT-based) and room creation/joining to the existing backgammon game. Users register/login with username + password, create rooms (gets a room code), and join rooms by code. The Django backend uses REST Framework + SimpleJWT.

## Architecture

```
Frontend (React)          Backend (Django)
───────────────           ──────────────
Auth Page      ──POST──>  /api/register/   → Create User
               ──POST──>  /api/login/      → Return JWT tokens
Lobby Page     ──POST──>  /api/rooms/      → Create room, assign white
               ──POST──>  /api/rooms/join/ → Join room by code, assign black
               ──GET──>   /api/rooms/<code>/→ Room status
Game Screen    ──WS──>    ws://...?token=   → Authenticated WebSocket
```

## Backend Changes

### Dependencies (requirements.txt)

Add: `djangorestframework`, `djangorestframework-simplejwt`

### Models

Extend `GameRoom` model with user foreign keys:

```python
from django.contrib.auth.models import User

class GameRoom(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=6, unique=True)
    white_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='white_games')
    black_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='black_games')
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    target_points = models.IntegerField(default=7)
    status = models.CharField(max_length=20, default='waiting')  # waiting, playing, finished
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

### API Endpoints

All endpoints return JSON. Auth endpoints are unauthenticated. Room endpoints require `Authorization: Bearer <token>`.

**POST /api/register/**
- Body: `{ "username": "...", "password": "...", "password2": "..." }`
- Validates passwords match, username unique
- Returns `{ "id", "username", "access", "refresh" }`

**POST /api/login/**
- Body: `{ "username": "...", "password": "..." }`
- Returns `{ "access", "refresh", "user": { "id", "username" } }`

**POST /api/rooms/**
- Auth required
- Body: `{}` (empty)
- Generates 6-char alphanumeric code, creates room, assigns creator as white_player
- Returns `{ "id", "code", "status", "white_player": { "id", "username" } }`

**POST /api/rooms/join/**
- Auth required
- Body: `{ "code": "..." }`
- Finds room by code with `status == "waiting"`, assigns user as black_player, sets status to "playing"
- Returns `{ "id", "code", "status", "white_player", "black_player" }`
- Error if room not found, already full, or user already in a room

**GET /api/rooms/<code>/**
- Auth required
- Returns room status, player info, and current game state

### WebSocket Auth

When connecting to the WebSocket, pass JWT as query param:
```
ws://localhost:8000/ws/game/<room_id>/?token=<access_token>
```

In `GameConsumer.connect()`, validate the token before accepting:

```python
from rest_framework_simplejwt.tokens import AccessToken

async def connect(self):
    token = self.scope['query_string'].decode().split('token=')[-1]
    try:
        valid_token = AccessToken(token)
        self.user_id = valid_token['user_id']
    except Exception:
        await self.close()
        return
    # ... rest of connect
```

### URL Structure

```python
urlpatterns = [
    path('api/register/', RegisterView.as_view()),
    path('api/login/', TokenObtainPairView.as_view()),
    path('api/rooms/', CreateRoomView.as_view()),
    path('api/rooms/join/', JoinRoomView.as_view()),
    path('api/rooms/<str:code>/', RoomDetailView.as_view()),
]
```

## Frontend Changes

### New Pages

1. **AuthPage** (`/`) — Two tabs: Register / Login. Traditional HTML forms. On success, stores `{ access, refresh, user }` in localStorage, redirects to `/lobby`.

2. **LobbyPage** (`/lobby`) — Two buttons:
   - "Create Room" → POST to `/api/rooms/` → shows room code with copy button, auto-redirects to game
   - "Join Room" → input for room code → POST to `/api/rooms/join/` → redirects to game

3. **GamePage** (`/game/<room_code>`) — Updated `GameScreen`. Uses room code from URL params.

### Auth Context

An `AuthContext` provider wraps the app. Provides:
- `user: { id, username } | null`
- `token: string | null`
- `login(username, password)` → sets token + user
- `register(username, password)` → sets token + user
- `logout()` → clears localStorage
- `isAuthenticated: boolean`

On mount, reads token from localStorage. All API calls include `Authorization: Bearer <token>` header.

### Updated Components

- `App.tsx` — Wraps with AuthProvider, renders AuthPage if not authenticated, LobbyPage or GamePage if authenticated
- `GameProvider` — Passes token to WebSocket connection as query param
- `socket.ts` — Accepts token in connect, attaches to URL

### File Changes

| File | Change |
|---|---|
| `src/App.tsx` | Auth routing (unauthenticated → AuthPage, authenticated → Lobby/Game) |
| `src/services/authContext.tsx` | New — AuthContext provider |
| `src/services/api.ts` | New — fetch wrapper that auto-adds Bearer token, handles 401 |
| `src/services/socket.ts` | Accept token param, pass in WS URL |
| `src/services/gameContext.tsx` | Remove local mode, use token from AuthContext for WS |
| `src/components/AuthPage/` | New — register/login form |
| `src/components/LobbyPage/` | New — create/join room |
| `src/components/GameScreen/` | Read room code from URL params |
| `src/lib/player.ts` | May no longer be needed (auth replaces player ID logic) |

### Lobby Page Flow

```
Create Room → POST /api/rooms/ → receive { code } → redirect to /game/<code>
Join Room  → input code → POST /api/rooms/join/ → redirect to /game/<code>
```

Room code displayed after creation with a "Copy Code" button. User waits on the game page for opponent to join (WebSocket `player_joined` event).

## Error Handling

- Register: username taken, passwords don't match, too short
- Login: wrong credentials
- Create room: already in a room
- Join room: invalid code, room full, already in a room
- API 401: auto-logout, redirect to auth page
- WebSocket: reject with close code if token invalid

## Scope & Sequence

1. Backend: install deps, add models/migrations, write API views and URLs
2. Backend: add JWT validation to WebSocket consumer
3. Frontend: create AuthContext + api.ts fetch wrapper
4. Frontend: create AuthPage (register/login)
5. Frontend: create LobbyPage (create/join room)
6. Frontend: update App.tsx routing, GameProvider, socket.ts
7. Test full flow: register → create room → join room → play
