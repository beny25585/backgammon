# Reliable match history and analysis delivery

## Responsibilities

- `game.event_history.persist_game_action` commits the state, room version,
  history ordinal and event in one short transaction. Player broadcasts follow
  that commit. There is no background event write or task per move.
- `game.game_service` records scores, seals the final history ordinal on the
  completed `Match`, and creates its unique analysis task in the same scoring
  transaction. It does not send analysis HTTP requests.
- `game.analysis.payload` validates the sealed history and builds the contract.
- `game.analysis.outbox` freezes that contract on the existing task before HTTP.
  The existing task worker owns delivery, leases and retry scheduling. The old
  `game.analysis_outbox` callable delegates to this implementation so queued
  tasks keep working.

`last_sequence` remains the client state version, including inactivity warnings
and other state updates. `history_sequence` counts only committed game events.
Readiness requires every history ordinal from 1 to the sealed match boundary,
with no missing or duplicate ordinal. Events must belong to recorded games and
contain valid object payloads. State-version gaps do not imply missing moves.

All games' events are read in one query when the package is first prepared.
`Task.delivery_payload` is committed before sending. Retries read the already
claimed task's payload and do not rebuild it from players, state or events.
The payload is persisted JSON; object key ordering is not part of the contract.

Network failures, HTTP 408/429/5xx and missing acknowledgements retry with the
existing exponential delay: approximately 30 seconds through 30 minutes, plus
jitter. They continue beyond the old ten-attempt limit. HTTP rejection and
invalid or incomplete data leave the task `blocked` with `last_error`, without
repeated HTTP calls. Success requires the expected match ID, an analysis ID and
an `accepted` or `already_exists` acknowledgement.

## Migration and existing history

Migration `0022_analysis_history` is required before the updated API and worker
start. Coordinate their upgrade: older processes do not write the new history
ordinals. Finish existing active games before the switch when possible, then
stop the old API/worker, apply the migration and start the updated processes.

Existing rooms and matches retain a NULL history boundary. The migration does
not number surviving events and falsely declare them complete. New rooms start
at zero. Existing games remain playable, but analysis tasks for unverified
history block for inspection. This change alone does not reconstruct missing
historical events or repair the previously failed rehearsal task.

For an old failure, inspect that task's match, all event state versions and game
IDs, completed game records, final state and relevant server logs. A maximum
event version below the room version can be a state-only update; it is not proof
of a missing move. A surviving final event does not prove there are no gaps.
Any repair must establish completeness before setting a trusted boundary and
re-enabling delivery. Do not discard a previously frozen payload after a lost
HTTP response; it may already have been accepted remotely.

## Validation to run

These commands were prepared but not executed. Use a dedicated local or
rehearsal test environment. PostgreSQL is required to verify row locking and
concurrent task ownership; SQLite cannot establish those guarantees. Do not
point this validation at a production environment or production database.

From the `Backgammon Game` repository root in PowerShell, with its isolated test
environment configured:

```powershell
& .\.venv\Scripts\python.exe .\backend\manage.py makemigrations --check --dry-run
& .\.venv\Scripts\python.exe .\backend\manage.py test game.tests.analysis game.tests.gameplay.test_event_history game.tests.gameplay.test_game_event_scoping game.tests.gameplay.test_series_endings game.tests.test_action_latency game.tests.test_task_ownership game.tests.test_legacy.GameConsumerTests.test_move_broadcast_follows_committed_state_and_history game.tests.test_legacy.FinalizeRoomTests game.tests.test_legacy.MatchContinuationTests --verbosity 2
```

The tests cover rollback after event-write failure, independent history ordinals,
database uniqueness, match sealing, missing middle events, invalid payloads,
state-only warning updates, a single event query for multiple games, frozen
retry payloads, lease replacement and retries past ten attempts. The WebSocket
test checks that the broadcast follows committed state and history.

For rollout, use the configured runtime's Python and environment to apply
`manage.py migrate game 0022` while the old game API and worker are stopped.
That migration and the service restart were not executed here.

## Response-time measurement

Static query accounting for persistence is five data statements for a player
action (room SELECT/UPDATE, state UPDATE, player SELECT, event INSERT), or four
for a system action. This excludes transaction control statements. Player data
statement count is unchanged from the previous state-plus-event path; both
writes now share a commit and executor admission. It is not a measured latency
result: the event INSERT is now awaited before broadcast.

In an isolated rehearsal, temporarily enable DEBUG for `game.server_actions`.
`GAME_ACTION_TIMING` logs `total_ms`, `persist_ms` and `broadcast_ms` for normal
actions; `SLOW_GAME_ACTION` includes the same fields for actions at least 250 ms.
For slow database calls, `game.db_timing` separately reports executor wait,
database execution and SQL count. No payload contents are logged by these
timing messages.

Compare the same game workload and concurrency before and after this change.
Measure p50/p95/p99 for client intent-to-response and server persistence,
including late-match states with long move history. Exercise an analysis outage
and a lost response, restart the worker, and verify the saved package is reused
and accepted only once by match ID. Latency and PostgreSQL runtime validation
remain required before treating this as deployment-ready.

## References

- [Django 4.2 transactions](https://docs.djangoproject.com/en/4.2/topics/db/transactions/):
  atomic rollback and keeping transactions short.
- [AWS transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html):
  durable local writes followed by retryable, idempotent external delivery.
