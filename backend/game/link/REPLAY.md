Linked results and replay
=========================

New result callbacks contain the existing settlement fields and `match_details` summary, with no inline `games` array. A `replay` reference contains version 1, the match UUID, game count and the SHA-256 digest of canonical JSON history. Complete history remains in `Match.games`; fetching replay never blocks settlement or depends on the analysis worker.

The game endpoint `POST /api/link/replay/` accepts the existing command-channel timestamp and HMAC headers. Its signed body includes `v`, `action: read_replay`, `issuer`, `fixture_id`, `room_id`, `match_id`, `game_index`, `turn_offset` and `limit`. The issuer must match the accepted header identity. The request is limited to 4 KiB. The link, frozen result, match and stored-history digest must agree. Responses contain one game's summary and at most 50 whole turns within 48 KiB, with total turn count and the next offset. A single oversized turn is refused rather than truncated.

The club's authenticated `GET /api/gamelink/fixture/<fixture_id>/replay/` bridge uses the existing progress visibility for started tournaments, obtains identifiers only from the stored result, signs the peer request and validates/bounds its response. The player replay composable retains one page, cancels old requests when the account, fixture or replay changes, and continues reading old callbacks that contain inline history.

Deploy club bridge and compatible player UI before deploying compact game callbacks. Existing command-channel secrets and trusted game base URL are required. This change adds no schema migration. Apply the application's existing migrations normally; do not remove old result audit data.

Oversized frozen result recovery
-------------------------------

New code does not rewrite already queued result bodies. This command inspects only explicitly selected links and defaults to a dry run:

```powershell
python manage.py compact_result_payloads --link-id 123
```

After reviewing the dry run and confirming compatible replay consumers are deployed, an operator can apply the same selection:

```powershell
python manage.py compact_result_payloads --link-id 123 --apply --reason "Reviewed oversized result recovery"
```

The command accepts only untouched queued results whose existing task is blocked for HTTP 413 and whose original audit matches the stored match exactly. It preserves the complete original body in that task's existing `delivery_payload`, keeps score/financial fields and task identity, replaces only the inline transcript with its reference, and returns the task to pending. It performs no HTTP delivery and never marks a result delivered. Invalid or mismatched records are refused for manual investigation. These commands have not been run against an existing database as part of the change.
