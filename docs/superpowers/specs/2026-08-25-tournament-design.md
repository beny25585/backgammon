# Tournament System — Design Spec

**Date:** 2026-08-25  
**Status:** Approved  
**Scope:** Backend only (v1) — single elimination, scheduled/auto-start, PostgreSQL

---

## 1. Summary

Add scheduled single-elimination tournaments to the backgammon backend. A tournament is created with a future `starts_at`; players sign up while it is `scheduled`; at `starts_at` the bracket is seeded, round-1 rooms are created, and the tournament runs to a champion via automatic winner-advancement. Bracket updates are pushed over a tournament WebSocket channel; actual games reuse the existing `GameRoom` + `record_game_end` flow.

---

## 2. Goals / Non-Goals

**Goals (v1):**
- Single elimination with bye handling (min players + pad to next power of 2).
- Scheduled creation with automatic start at `starts_at` (DB `Task` + lazy-start safety net).
- Seeding by signup order (no rating in v1).
- Fixed match settings per tournament (`target_points`, `time_control`).
- Automatic bracket progression: winner advances, next round generated when current round completes.
- WebSocket channel for bracket/round/match-ready events.
- PostgreSQL in both local dev and prod (no SQLite fallback).

**Non-Goals (v1):**
- Double elimination / round robin / Swiss.
- No-show / forfeit timers (assume players show up).
- Rating-based seeding.
- Entry fees / prizes.
- Frontend (covered by a later spec).

---

## 3. Architecture Overview

```
                 REST                    WS
Client ───────────────► Tournament views ──────────────┐
  │                          │                         │
  │ create/join/leave        │ queues Task             │ group_send
  │                          ▼                         │
  │                    Task (run_at=starts_at)         │
  │                          │ run_tasks (cron)        │
  │                          ▼                         │
  │                 start_tournament()  ───────────────┼──► tournament_<id> group
  │                          │ creates BracketMatch     │     (TournamentConsumer)
  │                          │ + GameRoom per pairing   │
  │                          ▼                         │
  │                 GameRoom (playing) ◄── existing game WS (ws/game/<room_id>/)
  │                          │                         │
  │                          │ record_game_end()       │
  │                          ▼                         │
  │                 report_result() ───────────────────┼──► round/bracket broadcasts
  │                          │ next round or           │
  │                          │ champion                │
```

New Django app: `backend/tournament/` (models, services, views, serializers, consumers, routing, urls).

---

## 4. Data Models

### 4.1 Tournament

```python
class Tournament(models.Model):
    STATUS = [('scheduled','Scheduled'), ('running','Running'),
              ('completed','Completed'), ('cancelled','Cancelled')]

    id            = UUIDField(primary_key=True, default=uuid.uuid4)
    name          = CharField(max_length=80)
    status        = CharField(max_length=10, choices=STATUS, default='scheduled')
    starts_at     = DateTimeField()  # UTC; registration closes & bracket seeds
    min_players   = PositiveSmallIntegerField(default=4)
    max_players   = PositiveSmallIntegerField(null=True, blank=True)
    target_points = PositiveSmallIntegerField(default=5)
    time_control  = CharField(max_length=20, default='normal',
                              choices=[('none','None'),('fast','Fast'),
                                       ('normal','Normal'),('slow','Slow')])
    created_by    = ForeignKey(User, null=True, on_delete=models.SET_NULL,
                               related_name='created_tournaments')
    champion      = ForeignKey(Player, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='tournament_championships')
    created_at    = DateTimeField(auto_now_add=True)
    updated_at    = DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-starts_at']
```

### 4.2 TournamentSignup

```python
class TournamentSignup(models.Model):
    tournament = ForeignKey(Tournament, on_delete=models.CASCADE, related_name='signups')
    player     = ForeignKey(Player, on_delete=models.CASCADE, related_name='tournament_signups')
    seed       = PositiveSmallIntegerField(null=True, blank=True)  # assigned at seeding
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [UniqueConstraint(fields=['tournament','player'],
                                        name='unique_tournament_player')]
        ordering = ['created_at']
```

### 4.3 BracketMatch

```python
class BracketMatch(models.Model):
    STATUS = [('pending','Pending'), ('playing','Playing'),
              ('completed','Completed')]

    id            = UUIDField(primary_key=True, default=uuid.uuid4)
    tournament    = ForeignKey(Tournament, on_delete=models.CASCADE, related_name='matches')
    round_number  = PositiveSmallIntegerField()  # 1 = first round
    slot          = PositiveSmallIntegerField()  # 0-indexed within round
    white_player  = ForeignKey(Player, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='tournament_matches_as_white')
    black_player  = ForeignKey(Player, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='tournament_matches_as_black')
    room          = ForeignKey(GameRoom, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='bracket_match')
    winner        = ForeignKey(Player, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='tournament_match_wins')
    status        = CharField(max_length=10, choices=STATUS, default='pending')

    class Meta:
        constraints = [UniqueConstraint(fields=['tournament','round_number','slot'],
                                        name='unique_tournament_round_slot')]
        ordering = ['round_number', 'slot']
```

**Notes:**
- `BracketMatch.room` is a real `GameRoom` created server-side per pairing; both `RoomPlayer`s are assigned immediately, `status='playing'`. Bye matches have `room=NULL` and auto-resolve.
- `Match` rows created by `game_service.record_game_end()` continue as-is; tournament results are derivable via `BracketMatch`.
- All models use Django ORM only (PostgreSQL-compatible: UUID PKs, `JSONField` not needed here; no raw SQL).

---

## 5. Lifecycle & Scheduling

### 5.1 Creation

`POST /api/tournaments/` validates `starts_at` (must be future), `min_players >= 2`, `target_points` in allowed set, `time_control` in allowed set, optional `max_players >= min_players`. Creates `Tournament(status='scheduled')` and queues:

```python
Task.objects.create(
    name='tournament.services.start_tournament',
    args=[str(tournament.id)],
    run_at=tournament.starts_at,
    status='pending',
)
```

### 5.2 Scheduling execution

- Primary: existing `python manage.py run_tasks` (cron/systemd every minute) resolves `Task(name='tournament.services.start_tournament')` and calls the function.
- Safety net (lazy start): any `GET /api/tournaments/` or `GET /api/tournaments/<id>/` or `TournamentConsumer.connect()` checks: if `tournament.starts_at <= now()` and `status == 'scheduled'` then call `start_tournament(tournament.id)` synchronously before returning. This makes dev work without cron and guards against runner delays.

### 5.3 Start — `tournament.services.start_tournament(tournament_id)`

Idempotent. Pseudocode:

```python
def start_tournament(tournament_id: str):
    with transaction.atomic():
        t = Tournament.objects.select_for_update().get(id=tournament_id)  # if not found: return
        if t.status != 'scheduled':
            return
        if t.starts_at > timezone.now():
            return  # fired early (clock skew) — re-queue or no-op
        signups = list(t.signups.select_related('player').order_by('created_at'))
        if len(signups) < t.min_players:
            t.status = 'cancelled'
            t.save()
            broadcast(t, 'tournament_cancelled', {'reason': 'not_enough_players'})
            return
        # enforce max_players if set: keep earliest signups, remove excess (FIFO)
        # assign seeds by signup order: seed = index+1
        # pad to next power of 2, byes go to top seeds
        bracket_size = 1 << (len(signups) - 1).bit_length()
        seeded = _seed_with_byes(signups, bracket_size)  # list length bracket_size, None = bye slot
        # generate round 1 BracketMatch rows
        for slot, (p_white, p_black) in enumerate(_pair_slots(seeded)):
            if p_white and p_black:
                room = _create_tournament_room(p_white, p_black, t.target_points, t.time_control)
                BracketMatch.objects.create(tournament=t, round_number=1, slot=slot,
                                            white_player=p_white, black_player=p_black,
                                            room=room, status='playing')
            elif p_white or p_black:
                winner = p_white or p_black
                BracketMatch.objects.create(tournament=t, round_number=1, slot=slot,
                                            white_player=p_white, black_player=p_black,
                                            winner=winner, status='completed')
            else:
                # both None cannot happen with correct padding; defensive: skip
                continue
        t.status = 'running'
        t.save()
        broadcast_bracket(t)
        broadcast(t, 'tournament_started', _bracket_payload(t))
        broadcast(t, 'round_started', {'round': 1, 'matches': _round_payload(t, 1)})
```

`_seed_with_byes`: place seeds in standard bracket order so top seeds receive byes. For v1, sequential placement is acceptable: fill slots 0..n-1 with seeds in order, remaining slots are `None`; `_pair_slots` pairs `(0,1)`, `(2,3)`, etc. Byes then fall to the last pairs (lowest seeds share byes) — alternatively distribute byes to top seeds by interleaving. Spec chooses **top-seed byes**: sort seeded list, then place `None` slots opposite top seeds (e.g., slot 1 vs seed 1). Simple deterministic helper, unit-tested.

`_create_tournament_room`: creates `GameRoom(code=uuid hex, status='playing', target_points=..., time_control=..., state=initial)`, two `RoomPlayer`s, and a `GameState`. Does NOT go through `views.create_room` (which blocks "already in a room"); tournament rooms are created server-side.

### 5.4 Progression — `tournament.services.report_result(bracket_match_id, winner_player_id)`

Called from `game.game_service.record_game_end()` after a room completes (lazy import to avoid circular deps). Pseudocode:

```python
def report_result(bracket_match_id, winner):
    with transaction.atomic():
        bm = BracketMatch.objects.select_for_update().get(id=bracket_match_id)
        t = Tournament.objects.select_for_update().get(id=bm.tournament_id)
        if t.status != 'running' or bm.status == 'completed':
            return
        bm.winner = winner
        bm.status = 'completed'
        bm.save()
        # check if round is fully complete
        round_matches = BracketMatch.objects.filter(tournament=t, round_number=bm.round_number)
        if round_matches.filter(status__in=['pending','playing']).exists():
            broadcast_bracket(t)
            return
        # round complete — collect winners in slot order
        winners = [m.winner for m in round_matches.order_by('slot')]
        if len(winners) == 1:
            # final completed
            t.status = 'completed'
            t.champion = winners[0]
            t.save()
            broadcast(t, 'tournament_completed', {'champion': PlayerSerializer(winners[0]).data})
            broadcast_bracket(t)
            return
        # generate next round
        next_round = bm.round_number + 1
        for slot, (p_white, p_black) in enumerate(_pair_slots(winners)):
            # winners list has no None (byes already resolved), but keep same helper
            room = _create_tournament_room(p_white, p_black, t.target_points, t.time_control)
            BracketMatch.objects.create(tournament=t, round_number=next_round, slot=slot,
                                        white_player=p_white, black_player=p_black,
                                        room=room, status='playing')
        broadcast_bracket(t)
        broadcast(t, 'round_started', {'round': next_round, 'matches': _round_payload(t, next_round)})
```

**Hook in `game_service.py`:**

At end of `record_game_end()` (after `Match` creation / room save), add:

```python
# tournament progression (no-op for casual rooms)
try:
    from tournament.services import report_result  # lazy import
    bm = None
    # avoid extra query if no tournament app installed: guard by try
    from tournament.models import BracketMatch
    bm = BracketMatch.objects.filter(room=locked).first()
    if bm and result is not None:
        winner_player = white_player if winner == 'white' else black_player
        report_result(str(bm.id), winner_player.id if winner_player else None)
except Exception:
    logger.exception("tournament report_result failed")
```

Guard: `cancel_room` view must reject rooms linked to an unfinished bracket match (`BracketMatch.objects.filter(room=room, status='playing').exists() → 400 "Tournament match cannot be cancelled"`).

Existence/idempotency guards: every service entry point checks `Tournament` exists and `status` is the expected value under `select_for_update`; duplicate Task fires or concurrent `record_game_end` calls are safe.

---

## 6. REST API

Base prefix: `/api/tournaments/` (registered via `backgammon_project/urls.py` → `include('tournament.urls')`).

| Method | Path | Auth | Request body | Success | Errors |
|--------|------|------|--------------|---------|--------|
| `POST` | `/tournaments/` | JWT required | `{ name, starts_at (ISO8601), min_players?, max_players?, target_points?, time_control? }` | `201 { tournament }` | `400` validation |
| `GET`  | `/tournaments/` | JWT required | query `?status=scheduled\|running\|completed` | `200 { tournaments: [...] }` | — |
| `GET`  | `/tournaments/<uuid:id>/` | JWT required | — | `200 { tournament, signups, bracket }` | `404` |
| `POST` | `/tournaments/<uuid:id>/join/` | JWT required | — | `200 { signup }` | `400` already joined / full / not scheduled / `404` |
| `POST` | `/tournaments/<uuid:id>/leave/` | JWT required | — | `200` | `400` not signed up / already started / `404` |
| `POST` | `/tournaments/<uuid:id>/cancel/` | creator only | — | `200` | `403` not creator / `400` already running |

Serializers: `TournamentSerializer`, `TournamentSignupSerializer`, `BracketMatchSerializer` (nested `whitePlayer`/`blackPlayer`/`winner` via `PlayerSerializer`). Detail serializer includes `signups` (ordered by `created_at`) and `bracket` (all `BracketMatch` rows ordered by `round_number, slot`).

Pagination for `GET /tournaments/` (page 1, 20 per page) mirrors `list_matches`.

`DATABASE_URL` must point to PostgreSQL; spec documents this as a requirement for local dev (e.g., `postgres://user:pass@localhost:5432/backgammon`).

---

## 7. WebSocket

### 7.1 Consumer

`backend/tournament/consumers.py` — `TournamentConsumer(AsyncWebsocketConsumer)` at `ws/tournament/<tournament_id>/`.

- Auth: JWT via query string `?token=<access>` (same as `game/consumers.py: get_user_id_from_token` + `AccessToken` validation). Anonymous → close `4401`.
- On `connect`: validate tournament exists, add to group `tournament_<id>`, accept, send snapshot:
  ```json
  { "type": "tournament_snapshot",
    "payload": { "tournament": {...}, "signups": [...], "bracket": [...] } }
  ```
  Lazy-start check runs before snapshot if `scheduled` and past `starts_at`.
- On `disconnect`: discard from group.
- No `receive` handling needed in v1 (read-only channel).

### 7.2 Broadcasts (via `channel_layer.group_send`)

All broadcasts have shape `{ "type": "tournament_event", "event": "<name>", "payload": {...} }` and the consumer forwards as `{ "type": event, "payload": payload }`.

| Event | When | Payload |
|-------|------|---------|
| `tournament_started` | bracket seeded | `{ bracket, round: 1, matches }` |
| `round_started` | next round generated | `{ round, matches }` |
| `match_ready` | (included in `round_started`; also sent per match for convenience) | `{ bracketMatchId, roomId, roomCode, whitePlayer, blackPlayer }` |
| `bracket_updated` | after each match result | `{ bracket }` |
| `tournament_completed` | final winner known | `{ champion }` |
| `tournament_cancelled` | not enough players at start | `{ reason }` |

Channel layer: `channels_redis` in prod/dev; `InMemoryChannelLayer` in tests (`settings.py` already switches on `'test' in sys.argv`). No new infra.

---

## 8. Wiring & Migrations

- `INSTALLED_APPS += ['tournament']`.
- `backend/tournament/routing.py` → `websocket_urlpatterns = [re_path(r'^ws/tournament/(?P<tournament_id>[^/]+)/$', TournamentConsumer.as_asgi())]`, merged in `backgammon_project/asgi.py` or `game/routing.py`.
- `backend/tournament/urls.py` → REST routes under `api/tournaments/`, included in `backgammon_project/urls.py`.
- `python manage.py makemigrations tournament && python manage.py migrate` — PostgreSQL required (`DATABASE_URL` set). UUID PKs and FKs translate to `uuid` columns in Postgres.

---

## 9. Error Handling

- `start_tournament` swallows `Tournament.DoesNotExist` (tournament deleted before Task fired) and logs.
- `report_result` swallows missing `BracketMatch`/race on `playing→completed` and logs; never raises to the game flow.
- REST views return `400` with `{ error: "..." }` for business-rule violations; `404` for missing tournament.
- WS `connect` closes with `4401` (unauthorized) or `4404` (tournament not found).
- `cancel_room` guard prevents stalling a running tournament.

---

## 10. Testing Strategy

Mirror `backend/game/tests.py` conventions. Use `django.test.TestCase` (transaction rollback per test, PostgreSQL in CI via `DATABASE_URL`) and `channels.testing.WebsocketCommunicator` for WS tests (InMemory layer).

| Area | Tests |
|------|-------|
| Seeding & byes | 5 players → bracket size 8, top seeds get byes; 4 players → no byes; 3 players → 4 slots with 1 bye; max_players FIFO trim. |
| `start_tournament` | Happy path; `< min_players` → cancelled; idempotent double-call; deleted tournament no-op; lazy-start via GET triggers seeding. |
| Progression | Round 1 winners advance → round 2 rooms created; final winner → `completed` + champion; `cancel_room` blocked for bracket rooms. |
| Hook | Casual room completion does not touch tournament service; bracket room completion advances bracket. |
| REST | Create valid/invalid `starts_at`; join duplicate → 400; leave after start → 400; cancel by non-creator → 403; detail includes bracket after start. |
| WebSocket | Snapshot on connect; `tournament_started` broadcast received; `round_started` after round completes; `tournament_completed` on final. |

---

## 11. Decisions & Open Questions Resolved

- Format: single elimination (approved).
- Creation: scheduled/auto-start via `Task(run_at=starts_at)` (approved).
- Match settings: fixed per tournament (approved).
- Advancement: winner auto-advances to next round vs waiting opponent in same round (approved).
- Player-count handling: min players + byes (approved).
- Seeding: signup order (approved; rating not used in v1).
- DB: PostgreSQL locally and in prod via `DATABASE_URL` (confirmed).
- Approach: orchestrator over existing `GameRoom`s (Approach A, approved).

---

## 12. Out of Scope (Future)

- Double elimination / round robin / Swiss.
- Forfeit / no-show timers.
- Rating / ELO updates from tournaments.
- Entry fees, prizes, leaderboards.
- Frontend screens (separate spec).
- Tournament chat / moderation.

---

## 13. Risks

- **Room conflict:** a player in a tournament match is technically "in an active room" and blocked from casual `create_room` (`views.create_room:87` checks `status__in=['waiting','playing']`). Acceptable for v1; could be relaxed later.
- **Cron dependency:** if `run_tasks` is not scheduled, tournaments rely on lazy-start. Mitigated by lazy check on every read + WS connect; document that `run_tasks` should run every minute in prod (`systemd timer` / `cron`).
- **Circular import:** `game_service` → `tournament.services` avoided via lazy import inside the hook function.

