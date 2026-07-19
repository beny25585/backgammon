# Auth & Room System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JWT-based user registration/login and room creation/join-by-code to the backgammon game.

**Architecture:** Django REST Framework + SimpleJWT for auth endpoints; updated WebSocket consumer validates JWT from query param; React frontend with AuthContext, LobbyPage and updated routing. GameRoom model extended with User foreign keys and auto-generated room codes.

**Tech Stack:** djangorestframework, djangorestframework-simplejwt, Django Channels, React + React Router

---

### Task 1: Install backend deps and update settings

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/backgammon_project/settings.py`

- [ ] **Step 1: Add DRF and SimpleJWT to requirements**

Append to `backend/requirements.txt`:
```
djangorestframework==3.14.0
djangorestframework-simplejwt==5.3.1
```

- [ ] **Step 2: Add apps and REST framework settings to settings.py**

In `INSTALLED_APPS`, add `'rest_framework'` and `'rest_framework_simplejwt'` before `'daphne'`.

At the bottom of `settings.py`, add:

```python
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

from datetime import timedelta
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
}
```

- [ ] **Step 3: Add django.contrib.sessions and django.contrib.staticfiles to INSTALLED_APPS**

In `INSTALLED_APPS`, add `'django.contrib.sessions'`, `'django.contrib.staticfiles'`, `'django.contrib.messages'`. Add session and auth middleware to `MIDDLEWARE`:

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]
```

- [ ] **Step 4: Install deps**

Run: `pip install -r requirements.txt`

- [ ] **Step 5: Commit**

```
git add backend/requirements.txt backend/backgammon_project/settings.py
git commit -m "feat: add DRF and SimpleJWT deps and config"
```

---

### Task 2: Update GameRoom model with user FK and room code

**Files:**
- Modify: `backend/game/models.py`

- [ ] **Step 1: Replace GameRoom model**

Replace entire `backend/game/models.py`:

```python
import uuid
import random
import string
from django.db import models
from django.contrib.auth.models import User


def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


class GameRoom(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=6, unique=True, default=generate_room_code)
    white_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='white_games')
    black_player = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='black_games')
    white_score = models.IntegerField(default=0)
    black_score = models.IntegerField(default=0)
    target_points = models.IntegerField(default=7)
    status = models.CharField(max_length=20, default='waiting')
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Room {self.code} ({self.status})"


class GameState(models.Model):
    room = models.OneToOneField(GameRoom, on_delete=models.CASCADE)
    state_data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"GameState for {self.room.code}"
```

- [ ] **Step 2: Create migration**

Run: `python manage.py makemigrations game`
Then: `python manage.py migrate`

You may get prompted about a default for the new FK fields. Enter `1` to set a temporary default (we'll delete the old DB anyway). Or better: delete `db.sqlite3` and migrate fresh:

```
del db.sqlite3
python manage.py migrate
```

- [ ] **Step 3: Commit**

```
git add backend/game/models.py backend/game/migrations/
git commit -m "feat: update GameRoom model with user FK and room code"
```

---

### Task 3: Create auth API endpoints (register/login)

**Files:**
- Create: `backend/game/serializers.py`
- Modify: `backend/game/views.py`
- Modify: `backend/game/urls.py`

- [ ] **Step 1: Create serializers**

Create `backend/game/serializers.py`:

```python
from django.contrib.auth.models import User
from rest_framework import serializers


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=4)
    password2 = serializers.CharField(write_only=True, min_length=4)

    class Meta:
        model = User
        fields = ('id', 'username', 'password', 'password2')

    def validate(self, data):
        if data['password'] != data['password2']:
            raise serializers.ValidationError({"password2": "Passwords do not match"})
        if User.objects.filter(username=data['username']).exists():
            raise serializers.ValidationError({"username": "Username already taken"})
        return data

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            password=validated_data['password']
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username')
```

- [ ] **Step 2: Create register view and update views.py**

Replace `backend/game/views.py`:

```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from .serializers import RegisterSerializer, UserSerializer
from .models import GameRoom


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    user = serializer.save()
    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserSerializer(user).data,
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }, status=status.HTTP_201_CREATED)
```

- [ ] **Step 3: Add URL routes**

Replace `backend/game/urls.py`:

```python
from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView
from . import views

urlpatterns = [
    path('register/', views.register, name='register'),
    path('login/', TokenObtainPairView.as_view(), name='login'),
    path('rooms/', views.create_room, name='create_room'),
    path('rooms/join/', views.join_room, name='join_room'),
    path('rooms/<str:code>/', views.room_detail, name='room_detail'),
]
```

- [ ] **Step 4: Add health endpoint (keep existing)**

In `views.py`, add back the health view:

```python
@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    return Response({'status': 'ok', 'message': 'Backgammon server is running'})
```

And in `urls.py`, add `path('health/', views.health, name='health'),`.

- [ ] **Step 5: Test register endpoint**

Run server: `python manage.py runserver`

Test: `curl -X POST http://localhost:8000/api/register/ -H "Content-Type: application/json" -d '{"username":"test","password":"pass123","password2":"pass123"}'`

Expected: 201 with `{ "user": { "id": 1, "username": "test" }, "access": "...", "refresh": "..." }`

- [ ] **Step 6: Commit**

```
git add backend/game/serializers.py backend/game/views.py backend/game/urls.py
git commit -m "feat: add register and login endpoints"
```

---

### Task 4: Create room API endpoints (create + join + detail)

**Files:**
- Modify: `backend/game/views.py`

- [ ] **Step 1: Add create_room view**

Append to `backend/game/views.py`:

```python
@api_view(['POST'])
def create_room(request):
    user = request.user
    # Check if user is already in an active room
    active_rooms = GameRoom.objects.filter(
        models.Q(white_player=user) | models.Q(black_player=user),
        status__in=['waiting', 'playing']
    )
    if active_rooms.exists():
        return Response({'error': 'Already in a room'}, status=status.HTTP_400_BAD_REQUEST)

    room = GameRoom.objects.create(white_player=user)
    # Initialize empty game state
    from .engine import BackgammonEngine
    initial_state = BackgammonEngine.get_initial_state()
    room.state = initial_state
    room.save()

    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'white_player': UserSerializer(user).data,
        'black_player': None,
    }, status=status.HTTP_201_CREATED)
```

Add import at top:
```python
from django.db import models
```

- [ ] **Step 2: Add join_room view**

Append to `backend/game/views.py`:

```python
@api_view(['POST'])
def join_room(request):
    code = request.data.get('code', '').upper().strip()
    user = request.user

    try:
        room = GameRoom.objects.get(code=code, status='waiting')
    except GameRoom.DoesNotExist:
        return Response({'error': 'Room not found or already full'}, status=status.HTTP_404_NOT_FOUND)

    if room.black_player is not None:
        return Response({'error': 'Room is full'}, status=status.HTTP_400_BAD_REQUEST)
    if room.white_player == user:
        return Response({'error': 'You are already in this room'}, status=status.HTTP_400_BAD_REQUEST)

    room.black_player = user
    room.status = 'playing'
    room.save()

    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'white_player': UserSerializer(room.white_player).data,
        'black_player': UserSerializer(user).data,
    })
```

- [ ] **Step 3: Add room_detail view**

Append to `backend/game/views.py`:

```python
@api_view(['GET'])
def room_detail(request, code):
    try:
        room = GameRoom.objects.get(code=code.upper())
    except GameRoom.DoesNotExist:
        return Response({'error': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'white_player': UserSerializer(room.white_player).data if room.white_player else None,
        'black_player': UserSerializer(room.black_player).data if room.black_player else None,
        'state': room.state,
    })
```

- [ ] **Step 4: Test endpoints**

Create room:
```bash
TOKEN="<access_token_from_login>"
curl -X POST http://localhost:8000/api/rooms/ -H "Authorization: Bearer $TOKEN"
```

Expected: 201 with `{ "code": "A3B2C9", ... }`

Join room:
```bash
curl -X POST http://localhost:8000/api/rooms/join/ -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" -d '{"code":"A3B2C9"}'
```

Expected: 200 with room data and black_player set.

- [ ] **Step 5: Commit**

```
git add backend/game/views.py
git commit -m "feat: add create, join, and detail room endpoints"
```

---

### Task 5: Add JWT validation to WebSocket consumer

**Files:**
- Modify: `backend/game/consumers.py`

- [ ] **Step 1: Update connect to parse and validate JWT from query string**

In `backend/game/consumers.py`, add import and update `connect`:

```python
import json
import traceback
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from rest_framework_simplejwt.tokens import AccessToken
from .engine import BackgammonEngine
from .models import GameRoom, GameState
```

Replace the `connect` method:

```python
    async def connect(self):
        # Validate JWT from query string
        query_string = self.scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]

        if not token:
            await self.close(code=4001)
            return

        try:
            valid_token = AccessToken(token)
            self.user_id = valid_token['user_id']
            self.user = await database_sync_to_async(User.objects.get)(id=self.user_id)
        except Exception:
            await self.close(code=4001)
            return

        self.room_id = self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')
        self.room_group_name = f'game_{self.room_id}'
        self.player_color = None
        self.engine = None

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

        try:
            room = await get_or_create_room(self.room_id)
            game_state = await get_game_state(room)

            if not game_state.state_data:
                game_state.state_data = BackgammonEngine.get_initial_state()
                await save_game_state(game_state)

            self.engine = BackgammonEngine(game_state.state_data)

            # Determine color by checking room's player assignments
            if room.white_player and str(room.white_player.id) == str(self.user_id):
                self.player_color = 'white'
            elif room.black_player and str(room.black_player.id) == str(self.user_id):
                self.player_color = 'black'
            else:
                # Spectator or unassigned - reject
                await self.close(code=4003)
                return

            room = await assign_player(
                room.id, self.player_color, self.channel_name
            )

            await self.send(json.dumps({
                'type': 'state_update',
                'payload': self.engine.state,
                'playerColor': self.player_color
            }))

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_joined',
                    'playerColor': self.player_color
                }
            )
        except Exception as e:
            traceback.print_exc()
            try:
                await self.send(json.dumps({
                    'type': 'error',
                    'message': str(e)
                }))
            except Exception:
                pass
            await self.close()
```

- [ ] **Step 2: Update assign_player helper to use room.id (UUID) not room_id string**

Replace the `assign_player` function:

```python
@database_sync_to_async
def assign_player(room_id, color, channel_name):
    try:
        room = GameRoom.objects.get(id=room_id)
    except GameRoom.DoesNotExist:
        return None
    if color == 'white':
        room.white_player = room.white_player  # keep user FK, don't overwrite with channel_name
    else:
        room.black_player = room.black_player
    room.save()
    return room
```

Actually, since the player is now determined by the User FK (not channel_name), simplify: just store the channel_name separately on the room or remove the `assign_player` / `clear_player` functions since they're no longer needed for channel tracking. Instead, use a simple dict in memory or drop them.

Simplest approach: remove `assign_player` and `clear_player` calls entirely. The consumer already knows the user's color from the room FK. Remove those helper functions.

- [ ] **Step 3: Remove assign_player and clear_player helpers, remove their calls**

Remove `assign_player` and `clear_player` functions. In `connect()`, remove call to `assign_player`. In `disconnect()`, remove call to `clear_player`.

- [ ] **Step 4: Update `get_or_create_room` to work with UUID string**

```python
@database_sync_to_async
def get_or_create_room(room_id):
    import uuid
    try:
        room = GameRoom.objects.get(id=uuid.UUID(room_id))
    except (GameRoom.DoesNotExist, ValueError):
        return None
    return room
```

- [ ] **Step 5: Commit**

```
git add backend/game/consumers.py
git commit -m "feat: add JWT validation to WebSocket consumer"
```

---

### Task 6: Create AuthContext and API fetch wrapper (frontend)

**Files:**
- Create: `frontend/src/services/authContext.tsx`
- Create: `frontend/src/services/api.ts`

- [ ] **Step 1: Create api.ts fetch wrapper**

Create `frontend/src/services/api.ts`:

```typescript
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

function getToken(): string | null {
  return localStorage.getItem("access_token");
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    window.location.href = "/";
    throw new Error("Unauthorized");
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || JSON.stringify(data));
  }
  return data as T;
}
```

- [ ] **Step 2: Create AuthContext**

Create `frontend/src/services/authContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { apiFetch } from "./api";

interface User {
  id: number;
  username: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("access_token"),
  );

  const isAuthenticated = !!token && !!user;

  const storeSession = (access: string, refresh: string, user: User) => {
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
    localStorage.setItem("user", JSON.stringify(user));
    setToken(access);
    setUser(user);
  };

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL || "http://localhost:8000/api"}/login/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    // SimpleJWT returns { access, refresh } but no user info
    // Fetch user info separately
    const userRes = await apiFetch<{ id: number; username: string }>("/register/", {
      method: "POST",
      body: JSON.stringify({ username, password, password2: password }),
    });
    // Actually we need a /me/ endpoint. Simpler: decode the token
    const payload = JSON.parse(atob(data.access.split(".")[1]));
    const user: User = { id: payload.user_id, username };
    storeSession(data.access, data.refresh, user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<{
      user: User;
      access: string;
      refresh: string;
    }>("/register/", {
      method: "POST",
      body: JSON.stringify({ username, password, password2: password }),
    });
    storeSession(data.access, data.refresh, data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 3: Commit**

```
git add frontend/src/services/authContext.tsx frontend/src/services/api.ts
git commit -m "feat: add AuthContext and API fetch wrapper"
```

---

### Task 7: Create AuthPage (register/login)

**Files:**
- Create: `frontend/src/components/AuthPage/AuthPage.tsx`
- Create: `frontend/src/components/AuthPage/AuthPage.module.css`
- Create: `frontend/src/components/AuthPage/index.ts`

- [ ] **Step 1: Create AuthPage component**

Create `frontend/src/components/AuthPage/AuthPage.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "../../services/authContext";

export default function AuthPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "register") {
        if (password !== password2) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        await register(username, password);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a] p-4">
      <div className="bg-[#2a1810] rounded-2xl p-8 w-full max-w-sm shadow-2xl border border-[#c9a961]/30">
        <h1 className="text-2xl font-bold text-center text-[#c9a961] mb-6">Backgammon</h1>

        <div className="flex mb-6 bg-black/30 rounded-lg p-1">
          <button
            onClick={() => setTab("login")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              tab === "login" ? "bg-[#c9a961] text-black" : "text-[#c9a961]/60"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setTab("register")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              tab === "register" ? "bg-[#c9a961] text-black" : "text-[#c9a961]/60"
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-black/40 border border-[#c9a961]/20 text-white placeholder-[#c9a961]/40 focus:outline-none focus:border-[#c9a961] text-sm"
            required
            minLength={3}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-black/40 border border-[#c9a961]/20 text-white placeholder-[#c9a961]/40 focus:outline-none focus:border-[#c9a961] text-sm"
            required
            minLength={4}
          />
          {tab === "register" && (
            <input
              type="password"
              placeholder="Confirm password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-black/40 border border-[#c9a961]/20 text-white placeholder-[#c9a961]/40 focus:outline-none focus:border-[#c9a961] text-sm"
              required
              minLength={4}
            />
          )}
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-[#c9a961] to-[#b8860b] text-black font-bold text-sm hover:brightness-110 transition disabled:opacity-50"
          >
            {loading ? "Please wait..." : tab === "login" ? "Login" : "Register"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/AuthPage/index.ts`:
```typescript
export { default } from "./AuthPage";
```

- [ ] **Step 2: Commit**

```
git add frontend/src/components/AuthPage/
git commit -m "feat: add AuthPage with register/login forms"
```

---

### Task 8: Create LobbyPage (create/join room)

**Files:**
- Create: `frontend/src/components/LobbyPage/LobbyPage.tsx`
- Create: `frontend/src/components/LobbyPage/LobbyPage.module.css`
- Create: `frontend/src/components/LobbyPage/index.ts`

- [ ] **Step 1: Create LobbyPage component**

Create `frontend/src/components/LobbyPage/LobbyPage.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "../../services/authContext";
import { apiFetch } from "../../services/api";

interface RoomResponse {
  id: string;
  code: string;
  status: string;
  white_player: { id: number; username: string } | null;
  black_player: { id: number; username: string } | null;
}

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [code, setCode] = useState("");
  const [createdRoom, setCreatedRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const room = await apiFetch<RoomResponse>("/rooms/", { method: "POST" });
      setCreatedRoom(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      const room = await apiFetch<RoomResponse>("/rooms/join/", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      window.location.href = `/game/${room.code}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  function handlePlay() {
    if (createdRoom) {
      window.location.href = `/game/${createdRoom.code}`;
    }
  }

  function copyCode() {
    if (createdRoom) {
      navigator.clipboard.writeText(createdRoom.code);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a] p-4">
      <div className="bg-[#2a1810] rounded-2xl p-8 w-full max-w-md shadow-2xl border border-[#c9a961]/30">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#c9a961]">Backgammon</h1>
          <div className="flex items-center gap-3">
            <span className="text-[#c9a961]/60 text-sm">{user?.username}</span>
            <button
              onClick={logout}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Logout
            </button>
          </div>
        </div>

        {createdRoom ? (
          <div className="text-center space-y-4">
            <p className="text-[#c9a961]">Room created!</p>
            <div
              onClick={copyCode}
              className="text-4xl font-bold text-white bg-black/40 rounded-lg py-4 cursor-pointer hover:bg-black/60 transition"
            >
              {createdRoom.code}
            </div>
            <p className="text-[#c9a961]/60 text-sm">
              Click code to copy. Share it with your opponent.
            </p>
            <button
              onClick={handlePlay}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-[#c9a961] to-[#b8860b] text-black font-bold"
            >
              Play
            </button>
          </div>
        ) : (
          <>
            <div className="flex mb-6 bg-black/30 rounded-lg p-1">
              <button
                onClick={() => setTab("create")}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  tab === "create" ? "bg-[#c9a961] text-black" : "text-[#c9a961]/60"
                }`}
              >
                Create Room
              </button>
              <button
                onClick={() => setTab("join")}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  tab === "join" ? "bg-[#c9a961] text-black" : "text-[#c9a961]/60"
                }`}
              >
                Join Room
              </button>
            </div>

            {tab === "create" ? (
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-[#c9a961] to-[#b8860b] text-black font-bold hover:brightness-110 transition disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create New Room"}
              </button>
            ) : (
              <form
                onSubmit={(e) => { e.preventDefault(); handleJoin(); }}
                className="space-y-4"
              >
                <input
                  type="text"
                  placeholder="Enter room code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-lg bg-black/40 border border-[#c9a961]/20 text-white text-center text-2xl tracking-widest placeholder:text-base focus:outline-none focus:border-[#c9a961] uppercase"
                  maxLength={6}
                  required
                />
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-[#c9a961] to-[#b8860b] text-black font-bold hover:brightness-110 transition disabled:opacity-50"
                >
                  {loading ? "Joining..." : "Join Room"}
                </button>
              </form>
            )}

            {error && (
              <p className="text-red-400 text-sm text-center mt-4">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

Create `frontend/src/components/LobbyPage/index.ts`:
```typescript
export { default } from "./LobbyPage";
```

- [ ] **Step 2: Commit**

```
git add frontend/src/components/LobbyPage/
git commit -m "feat: add LobbyPage with create/join room"
```

---

### Task 9: Update App.tsx routing and socket connection

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/services/socket.ts`
- Modify: `frontend/src/services/gameContext.tsx`

- [ ] **Step 1: Update App.tsx with routing**

Replace `frontend/src/App.tsx`:

```tsx
import { AuthProvider, useAuth } from "./services/authContext";
import AuthPage from "./components/AuthPage";
import LobbyPage from "./components/LobbyPage";
import GameScreen from "./components/GameScreen";

function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  const path = window.location.pathname;

  if (path.startsWith("/game/")) {
    return <GameScreen />;
  }

  return <LobbyPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Update socket.ts to accept token**

Modify `frontend/src/services/socket.ts`. Add `token` parameter to `connect`:

```typescript
connect(roomId: string, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = token
          ? `${this.url}/ws/game/${roomId}/?token=${token}`
          : `${this.url}/ws/game/${roomId}/`;
        this.ws = new WebSocket(wsUrl);
        // ... rest stays the same
```

- [ ] **Step 3: Update GameProvider to use token from AuthContext**

Update `frontend/src/services/gameContext.tsx`:

Remove `local` mode. Read room code from URL and token from AuthContext:

```typescript
import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";
import type { GameContextType } from "../types/context";
import type { GameState, Color } from "../types/game";
import { getSocketService } from "./socket";
import { useAuth } from "./authContext";

export const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [state, setState] = useState<GameState | null>(null);
  const [playerColor, setPlayerColor] = useState<Color>("white");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const roomCode = window.location.pathname.replace("/game/", "");
  const socket = getSocketService();

  useEffect(() => {
    if (!token || !roomCode) return;

    const connectAndSetup = async () => {
      try {
        // First resolve room code to room ID via API
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:8000/api"}/rooms/${roomCode}/`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const room = await res.json();
        if (!res.ok) throw new Error(room.error || "Room not found");

        await socket.connect(room.id, token);
        setIsLoading(false);

        socket.on("state_update", (payload) => {
          if (typeof payload === "object" && payload !== null) {
            const data = payload as Record<string, unknown>;
            setState(data as unknown as GameState);
            if (data.playerColor) {
              setPlayerColor(data.playerColor as Color);
            }
          }
        });

        socket.on("error", (payload) => {
          const msg = typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as Record<string, unknown>).message)
            : String(payload);
          setError(msg);
        });

        socket.on("player_joined", () => {
          setIsLoading(false);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        setError(message);
        setIsLoading(false);
      }
    };

    connectAndSetup();
    return () => { socket.disconnect(); };
  }, [token, roomCode, socket]);

  const makeMove = useCallback((from: number | "bar", to: number | "off") => {
    socket.send("move", { from, to });
  }, [socket]);

  const rollDice = useCallback(() => {
    socket.send("roll_dice", {});
  }, [socket]);

  const offerDouble = useCallback(() => {
    socket.send("offer_double", {});
  }, [socket]);

  const respondToDouble = useCallback((accept: boolean) => {
    socket.send("respond_double", { accept });
  }, [socket]);

  const endTurn = useCallback(() => {
    socket.send("end_turn", {});
  }, [socket]);

  return (
    <GameContext.Provider value={{
      state, playerColor, isLoading, error,
      updateState: () => {},
      makeMove, rollDice, offerDouble, respondToDouble, endTurn,
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextType {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame must be used within GameProvider");
  return context;
}
```

- [ ] **Step 3: Commit**

```
git add frontend/src/App.tsx frontend/src/services/socket.ts frontend/src/services/gameContext.tsx
git commit -m "feat: update routing, socket auth, and game provider"
```

---

### Task 10: End-to-end test

- [ ] **Step 1: Start backend**

```
cd backend
python manage.py runserver
```

- [ ] **Step 2: Start frontend**

```
cd frontend
pnpm run dev
```

- [ ] **Step 3: Test full flow**

1. Open frontend at `http://localhost:5173` → should see AuthPage
2. Register user1 (username: "player1", password: "pass123")
3. Should redirect to LobbyPage showing username and Create/Join buttons
4. Click "Create Room" → see room code (e.g., "A3B2C9")
5. Open another browser/incognito window → Register user2
6. In user2's window, switch to "Join Room" tab, enter the code
7. Both should see game screen after opponent joins
8. Verify turns work correctly
