"""
Outbound result delivery.

When a linked fixture reaches an outcome, the tournaments server has to hear about it — that is
what advances the tournament. Delivery is a two-step arrangement and both steps matter:

1. `enqueue_result` builds the plan §3.2 body **inside the transaction that produced the outcome**,
   freezes it onto the `TournamentLink`, and writes a `Task` row. If the transaction rolls back,
   so does the promise to deliver; there is never a queued result for a game that did not end.
2. `deliver_result` signs and POSTs it. `transaction.on_commit` fires one best-effort attempt
   immediately so the common case is fast, and `manage.py run_tasks` retries the `Task` when that
   attempt fails. The `Task` row is the durable path; the immediate attempt is only an optimisation
   and its failures are swallowed.

The body is frozen once and re-sent verbatim, but the **timestamp and nonce are minted per
attempt**. That is deliberate: the receiver rejects a replayed nonce outright, so a retry reusing
one could never succeed. Retrying with a fresh nonce is safe because the receiver is idempotent at
the fixture level — a result it has already recorded comes back `200 already_recorded`.
"""

import json
import logging
import uuid
from datetime import timezone as dt_timezone

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from game.models import Task

from .signing import sign_result_body

logger = logging.getLogger(__name__)

RESULT_VERSION = 1
RESULT_PATH = '/api/gamelink/result/'
DELIVERY_TIMEOUT_SECONDS = 10.0

TASK_NAME = 'game.link.outbox.deliver_result'

# Statuses a fixture's outcome can be reported as. `cancelled` releases the fixture back to manual
# scoring; `completed` carries a score and advances the tournament.
STATUS_COMPLETED = 'completed'
STATUS_CANCELLED = 'cancelled'


def enqueue_result(link, match, room, status, *, winner_color=None, end_reason=None, score=None):
    """
    Freeze this fixture's outcome onto `link` and queue it for delivery.

    Returns the created `Task`, or `None` when there was nothing to do — a link that has already
    reported is left alone, which is what makes this safe to call from every ending path without
    each one having to know whether another got there first.

    Call it *inside* the transaction that produced the outcome. The immediate delivery attempt is
    registered with `transaction.on_commit`, so it cannot fire against a result that rolled back.
    """
    if link.result_status != 'pending':
        logger.info(
            f"result not enqueued: fixture {link.fixture_id} is already {link.result_status}")
        return None

    body = build_result_body(
        link, room, match,
        status=status,
        winner_color=winner_color,
        end_reason=end_reason,
        score=score,
    )

    link.result_body = body
    link.result_status = 'queued'
    link.save(update_fields=['result_body', 'result_status'])

    task = Task.objects.create(
        name=TASK_NAME,
        kwargs={'link_id': link.pk},
        # `run_tasks` selects on `run_at__lte=now`, and NULL never satisfies that comparison, so a
        # task left with `run_at=None` is invisible to the runner forever. Always stamp it.
        run_at=timezone.now(),
    )

    logger.info(
        f"result queued: fixture {link.fixture_id} status={status} "
        f"room={room.code} task={task.id}")

    transaction.on_commit(lambda: try_deliver_now(task.pk))
    return task


def build_result_body(link, room, match=None, *, status=STATUS_COMPLETED,
                      winner_color=None, end_reason=None, score=None):
    """
    Build the plan §3.2 result body.

    Scores are mapped onto **seats** here rather than colours, so the receiver never has to reason
    about which end of the board a player sat at. `winner_color` and `end_reason` default to the
    `Match`'s, and are passed explicitly for outcomes that produced no `Match` at all — a forfeit
    being the case that matters.
    """
    if match is not None:
        winner_color = winner_color or match.winner
        end_reason = end_reason or match.end_reason
        finished_at = match.created_at
    else:
        finished_at = timezone.now()

    p1_color = link.color_for_seat('p1')
    p2_color = link.color_for_seat('p2')

    if score is None:
        by_color = {'white': room.white_score, 'black': room.black_score}
        score = {'p1': by_color.get(p1_color, 0), 'p2': by_color.get(p2_color, 0)}

    if status == STATUS_CANCELLED:
        winner_seat = None
    elif winner_color == p1_color:
        winner_seat = 'p1'
    elif winner_color == p2_color:
        winner_seat = 'p2'
    else:
        winner_seat = None

    return {
        'v': RESULT_VERSION,
        'tournament_id': link.tournament_id,
        'fixture_id': link.fixture_id,
        'room_id': str(room.id),
        'match_id': str(match.id) if match is not None else None,
        'status': status,
        'target_points': room.target_points,
        'seats': {'p1': p1_color, 'p2': p2_color},
        'score': score,
        'winner_seat': winner_seat,
        'end_reason': end_reason,
        'finished_at': _iso_utc(finished_at),
        'match_details': _match_details(match) if match is not None else None,
    }


def _match_details(match):
    """
    Return the detailed, read-only audit data the tournament UI can show later.

    The tournament receiver treats unknown fields as audit metadata and stores the whole result
    body in GameLink.raw_result, so adding this block is backward-compatible.
    """
    return {
        'duration_seconds': match.duration_seconds,
        'match_type': match.match_type,
        'white_score': match.white_score,
        'black_score': match.black_score,
        'winner': match.winner,
        'target_points': match.target_points,
        'games': match.games,
        'end_reason': match.end_reason,
        'first_player': match.first_player,
        'opening_roll': match.opening_roll,
        'final_cube': match.final_cube,
        'hits': match.hits,
        'doubles_offered': match.doubles_offered,
        'doubles_accepted': match.doubles_accepted,
        'clock_remaining': match.clock_remaining,
    }


def deliver_result(link_id):
    """
    Sign and POST the frozen result for `link_id`.

    Raises on anything that is not a 2xx, which is what makes `run_tasks` retry: the exception is
    the retry signal. A link that is already `delivered` returns without sending, so a duplicated
    `Task` row costs one database read.
    """
    # Imported here rather than at module scope: `game.models` re-exports the link models at the
    # end of its own import, so a top-level import of them from a module that also imports
    # `game.models` is an ordering hazard for no gain.
    from .models import TournamentLink

    link = TournamentLink.objects.select_related('room').get(pk=link_id)

    if link.result_status == 'delivered':
        logger.info(f"result already delivered: fixture {link.fixture_id}")
        return {'status': 'already_delivered', 'fixture_id': link.fixture_id}

    if not link.result_body:
        raise RuntimeError(f"link {link_id} has no result body to deliver")

    base_url = (getattr(settings, 'GAMELINK_TOURNAMENTS_URL', '') or '').rstrip('/')
    if not base_url:
        raise RuntimeError('GAMELINK_TOURNAMENTS_URL is not configured')

    # Serialised once, and the *same bytes* are hashed and sent. Re-dumping the body for the
    # request would risk a different key order or separator than the one the signature commits to.
    raw = json.dumps(link.result_body, separators=(',', ':'), sort_keys=True).encode()

    timestamp = str(int(timezone.now().timestamp()))
    nonce = uuid.uuid4().hex

    headers = {
        'Content-Type': 'application/json',
        'X-Gamelink-Timestamp': timestamp,
        'X-Gamelink-Nonce': nonce,
        'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
        'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
    }

    url = f'{base_url}{RESULT_PATH}'
    # TLS verification is on by default and is deliberately not turned off: the signature proves
    # who wrote the body, but only TLS keeps a result out of a bystander's hands in transit.
    response = httpx.post(url, content=raw, headers=headers, timeout=DELIVERY_TIMEOUT_SECONDS)

    if response.status_code < 200 or response.status_code >= 300:
        # No response body in the log: it is a remote server's text and this line is not the place
        # to find out what it says.
        raise RuntimeError(
            f"result delivery for fixture {link.fixture_id} refused with "
            f"HTTP {response.status_code}")

    link.result_status = 'delivered'
    link.delivered_at = timezone.now()
    link.save(update_fields=['result_status', 'delivered_at'])

    logger.info(f"result delivered: fixture {link.fixture_id} -> HTTP {response.status_code}")
    return {'status': 'delivered', 'fixture_id': link.fixture_id}


def try_deliver_now(task_id):
    """
    Best-effort immediate delivery, so the common case does not wait for the next `run_tasks`.

    Every failure is swallowed on purpose. This runs from an `on_commit` hook, where raising would
    surface as an error on a request whose work has already been committed successfully — and the
    `Task` row is still there to be retried. The failure is logged and nothing else happens.
    """
    try:
        task = Task.objects.get(pk=task_id)
    except Task.DoesNotExist:
        return

    if task.status != 'pending':
        return

    task.attempts += 1
    task.status = 'running'
    task.save(update_fields=['attempts', 'status', 'updated_at'])

    try:
        result = deliver_result(**task.kwargs)
    except Exception as exc:
        task.status = 'pending'
        task.last_error = f'immediate attempt failed: {exc}'
        task.save(update_fields=['status', 'last_error', 'updated_at'])
        logger.warning(f"immediate result delivery failed, leaving it to run_tasks: {exc}")
        return

    task.status = 'done'
    task.result = result
    task.save(update_fields=['status', 'result', 'updated_at'])


def enqueue_forfeit(link, room, winner_color):
    """
    Report a fixture whose game never happened as a win for the player who did turn up.

    Plan §9 decision 2, answered 2026-08-29: an abandoned fixture auto-forfeits rather than falling
    back to manual scoring. The forfeit is scored as a full-length win — the tournament needs a
    definite result, and half a match is not one.

    Note the asymmetry with the room: the *room* is cancelled, because no game was played and
    backgammon should not claim otherwise, while the *fixture* is reported completed. The two
    statuses answer different questions.
    """
    loser_color = 'black' if winner_color == 'white' else 'white'
    by_color = {winner_color: room.target_points, loser_color: 0}

    p1_color = link.color_for_seat('p1')
    p2_color = link.color_for_seat('p2')
    score = {'p1': by_color.get(p1_color, 0), 'p2': by_color.get(p2_color, 0)}

    return enqueue_result(
        link, None, room, STATUS_COMPLETED,
        winner_color=winner_color,
        end_reason='forfeit',
        score=score,
    )


def _iso_utc(value):
    """Format a datetime as the `2026-08-27T12:02:20Z` the wire format asks for."""
    return value.astimezone(dt_timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
