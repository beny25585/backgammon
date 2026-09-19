# 6B — Game backend

Reviewed against local code: 2026-09-19. Dependencies declare Django 4.2.7, Channels 4, Daphne, DRF and SimpleJWT. This review did not run the server or tests.

## Start

Use a separate Python environment in this directory, install requirements.txt and apply migrations. Start ASGI with:

~~~sh
pip install -r requirements.txt
python manage.py migrate
daphne -b 127.0.0.1 -p 8000 backgammon_project.asgi:application
~~~

The Elixir dice service defaults to http://127.0.0.1:4000. CHANNEL_LAYER_BACKEND defaults to redis with REDIS_URL; memory is only suitable for a single-process local session. Database configuration comes from backgammon_project/settings.py.

## Authority and API

game/engine.py validates gameplay; game/consumers.py handles action intents and match lifecycle. game/routing.py currently routes through PracticeGameConsumer, which extends online handling for AI sessions. GameRoom, GameState, Match, Task and linked-room records persist state, results and delivery work. Match-level scoring is implemented; the old README's claim that it was missing is obsolete.

REST paths are defined in game/urls.py under /api/: health/, register/, login/, rooms/, rooms/join/, rooms/active/, rooms/cancel/, rooms/<code>/, matches/, matches/list/, matches/<uuid>/, rooms/<uuid>/result/, stats/, dice/roll/ and dice/health/. Creation, history and results have distinct authorization/authority checks; a client-submitted local result is not authority for a linked match or rating.

WebSocket: /ws/game/<room_id>/?token=<jwt>. The dispatcher uses action intents such as roll, move, reorder_dice, end_turn, undo, double, double_response and next_game. The old roll_dice/offer_double table was not the wire contract. Consult game/consumers.py and the frontend gameContext.tsx for complete payloads and current response events before changing clients.

## Background work and integrations

- run_tasks executes due persisted work once, including result retries and lifecycle tasks; invoke it repeatedly through the process supervisor/scheduler.
- expire_waiting_rooms expires waiting rooms; purge_redeemed_tickets cleans ticket replay records. check_delivery_health and retry_result support delivery operations.
- /api/link/admin-command/ accepts signed tournament admin commands, separately keyed from entry/results.
- AI uses /api/link/practice/prepare/ followed by /api/link/practice/; the club UI now loads the price and sends the required match options and request ID. No new end-to-end test was run in this review. [Practice details](../../docs/open-sage-practice.he.md).
- ANALYSIS_SERVICE_URL and ANALYSIS_API_TOKEN configure analysis delivery; AI_SERVICE_URL selects the bot service. The analysis worker runs in the separate analysis project.

See [task operation](DJANGO_Q.md), [system deployment](../../backgammon-tournaments-backend/DEPLOY_GAME_AND_CLUB.he.md) and [current state](../../CURRENT_STATE.he.md). Existing configuration and secret-rotation guidance follows; deployment status is not established by this document.

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
| `GAMELINK_TOURNAMENTS_FRONTEND_URL` | when enabled | Base URL of the tournaments frontend, `https://…`, no path. Players return here after a linked game. Locally this is usually `http://127.0.0.1:5174`. |
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
left undelivered. With it scheduled, network errors, HTTP 408/429 and 5xx retry with exponential
backoff from 30 seconds up to 30 minutes, without an attempt limit. Other HTTP refusals (including
409 conflicts) mark the task `blocked` and stop automatic retries. Previously failed result tasks
are still recovered; a repeated permanent refusal moves them to `blocked` too.

The admin's `Task` list is the delivery error view — filter to `status = blocked` and read the
full `error` column for the fixture, HTTP status, reason and required action in Hebrew. The frozen
result stays queued and is never marked delivered on a refusal. Authenticated result conflicts
include stable reason codes from the tournaments backend; older receivers get a fallback message
pointing to the tournaments log for that fixture. No email or push alert is sent.

After correcting the reported conflict or configuration, explicitly requeue a blocked delivery:

```bash
python manage.py retry_result <task-uuid>
python manage.py run_tasks
```

This preserves the result body, attempt count and last error until the next attempt. Do not replay
a stale result over an administrator's ruling; review the authoritative tournament result first.
Deploy both backends for detailed reasons, run `python manage.py migrate` on the game backend,
and restart the game web process and task worker. Deploying only the sender still stops 409 loops.

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
