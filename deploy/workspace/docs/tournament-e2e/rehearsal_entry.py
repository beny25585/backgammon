"""Passive entry spans, opt-in only for the guarded fresh server rehearsal.

SQL time includes execution/network/lock waits. It is not pure PostgreSQL lock
wait time. Nested spans overlap and must never be added to request totals.
"""
from contextlib import ExitStack
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import json
import logging
import os
from pathlib import Path
import re
from time import perf_counter
import uuid

from rehearsal_context import require_fresh_database_context


context = ContextVar('e2e_entry_context', default=None)
logger = logging.getLogger('e2e.admission')
_installed = False
_session_id = None
KINDS = {'game': 'backgammon_project.settings_docker', 'tournaments': 'tournaments.settings.docker'}


def validate_settings(identity, kind, database, redis_url):
    expected = require_fresh_database_context(identity)
    if kind not in KINDS or database.get('ENGINE') != 'django.db.backends.postgresql' \
            or database.get('NAME') != expected['databases'][kind] \
            or database.get('HOST') != 'postgres' or database.get('USER') != 'backgammon_' + kind \
            or redis_url != f'redis://redis:6379/{expected["redis_databases"][kind]}':
        raise ValueError('Entry instrumentation refuses a database outside the fresh rehearsal')


def session():
    return json.loads(Path('/opt/e2e/session.json').read_text())['identity']


def emit(phase, **fields):
    values = context.get()
    if values is None:
        return
    # Only explicitly constructed numeric IDs, opaque IDs and fixed labels enter this log.
    event = {'phase': phase, 'serverAt': datetime.now(timezone.utc).isoformat(),
             'sessionId': _session_id, 'service': os.environ['E2E_ADMISSION_KIND'], **values, **fields}
    event.pop('counters', None)
    counters = values.get('counters', {})
    event.update(invalidationCount=counters.get('count', 0), invalidationMs=round(counters.get('ms', 0), 3))
    logger.info('E2E_ADMISSION %s', json.dumps(event, separators=(',', ':')))


class Queries:
    def __init__(self):
        self.sql_count = 0
        self.sql_ms = 0.0
        self.lock_statement_count = 0
        self.lock_statement_ms = 0.0

    def __call__(self, execute, sql, params, many, query_context):
        started = perf_counter()
        is_lock = bool(re.search(r'\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\bBEGIN\s+IMMEDIATE\b', sql, re.I))
        try:
            return execute(sql, params, many, query_context)
        finally:
            duration = (perf_counter() - started) * 1000
            self.sql_count += 1
            self.sql_ms += duration
            if is_lock:
                self.lock_statement_count += 1
                self.lock_statement_ms += duration

    def fields(self):
        return {'sqlCount': self.sql_count, 'sqlMs': round(self.sql_ms, 3),
                'lockStatementCount': self.lock_statement_count,
                'lockStatementMs': round(self.lock_statement_ms, 3)}


def query_stack(metrics):
    from django.db import connections
    stack = ExitStack()
    for connection in connections.all():
        stack.enter_context(connection.execute_wrapper(metrics))
    return stack


def sync_span(operation, function, update=None):
    @wraps(function)
    def call(*args, **kwargs):
        if context.get() is None:
            return function(*args, **kwargs)
        metrics = Queries()
        started = perf_counter()
        succeeded = False
        try:
            with query_stack(metrics):
                result = function(*args, **kwargs)
            succeeded = True
            if update:
                update(result, args, kwargs)
            return result
        finally:
            emit('operation_complete', operation=operation, succeeded=succeeded,
                 executionMs=round((perf_counter() - started) * 1000, 3), **metrics.fields())
    return call


class AdmissionMiddleware:
    """One request total; no bodies, query strings, SQL or credentials are logged."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        selected = request.path == '/api/link/enter/' or bool(re.fullmatch(
            r'/api/gamelink/tournament/\d+/play/', request.path))
        if not selected:
            return self.get_response(request)
        inherited = context.get() or {}
        values = {**inherited, 'traceId': inherited.get('traceId', uuid.uuid4().hex)}
        match = re.search(r'/tournament/(\d+)/', request.path)
        if match:
            values['tournamentId'] = int(match[1])
        token = context.set(values)
        started = perf_counter()
        emit('http_processing_started')
        metrics = Queries()
        response = None
        try:
            with query_stack(metrics):
                response = self.get_response(request)
            response['X-E2E-Trace-ID'] = values['traceId']
            return response
        finally:
            emit('http_processing_complete', operation='game_enter' if request.path == '/api/link/enter/' else 'ticket_request',
                 status=response.status_code if response is not None else 500,
                 executionMs=round((perf_counter() - started) * 1000, 3), **metrics.fields())
            context.reset(token)


def identity_from_ticket(ticket, _args, _kwargs):
    values = context.get()
    if values is not None:
        values.update(tournamentId=ticket['trn'], fixtureId=ticket['fix'], seat=ticket['seat'])


def identity_from_fixture(result, _args, _kwargs):
    _, fixture, seat, refusal = result
    if fixture is not None and context.get() is not None:
        context.get().update(fixtureId=fixture.pk, seat=seat)


def seat_processed(started, args, _kwargs):
    from django.db import transaction
    values = dict(context.get() or {})
    values['roomId'] = str(args[0].pk)
    context.get().update(roomId=values['roomId'])
    def committed():
        token = context.set(values)
        try:
            emit('game_seat_committed')
            if started:
                emit('room_started_committed')
        finally:
            context.reset(token)
    transaction.on_commit(committed)


def install():
    global _installed, _session_id
    if _installed:
        return
    from django.conf import settings
    identity = session()
    kind = os.environ['E2E_ADMISSION_KIND']
    validate_settings(identity, kind, settings.DATABASES['default'], os.environ.get('REDIS_URL'))
    _session_id = identity['session_id']
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if kind == 'game':
        from game.link import views
        from game import entry_lifecycle
        for name, operation, update in (
            ('verify_ticket', 'verify_ticket', identity_from_ticket),
            ('resolve_user', 'resolve_identity', None),
            ('_link_for_fixture', 'find_or_create_room', None),
            ('_start_if_full', 'start_full_room', seat_processed),
        ):
            setattr(views, name, sync_span(operation, getattr(views, name), update))
        entry_lifecycle.active_room_for = sync_span('check_active_room', entry_lifecycle.active_room_for)
    else:
        install_tournament()
    _installed = True


def install_tournament():
    from gamelink import consumers, views, entry_presence
    from django.db import transaction
    from django.db.models.signals import post_save
    from tournaments.models import Fixture

    views._resolve_current_fixture = sync_span('resolve_current_fixture', views._resolve_current_fixture, identity_from_fixture)
    views._issue_game_ticket = sync_span('issue_ticket', views._issue_game_ticket)
    original_authorize = views._authorize_entry_pair

    @wraps(original_authorize)
    def authorize(request, fixture, link, now, **kwargs):
        was_authorized = bool(link.entry_authorized_at)
        result = original_authorize(request, fixture, link, now, **kwargs)
        if result and not was_authorized and context.get() is not None:
            saved = dict(context.get())
            def committed():
                token = context.set(saved)
                try:
                    emit('pair_authorization_committed', fixtureId=fixture.pk,
                         tournamentId=fixture.mode.tournament_id)
                finally:
                    context.reset(token)
            transaction.on_commit(committed)
        return result
    views._authorize_entry_pair = sync_span('authorize_pair', authorize)

    original_change = entry_presence.change
    @wraps(original_change)
    def change(fixture_id, seat, token, channel, action, now=None):
        result = original_change(fixture_id, seat, token, channel, action, now)
        if action == 'join' and result:
            emit('presence_join_saved', fixtureId=fixture_id, seat=seat, attemptId=token)
        return result
    entry_presence.change = change

    original_adapter = consumers.database_sync_to_async
    def adapter(function, *adapter_args, **adapter_kwargs):
        if function.__name__ != 'state':
            return original_adapter(function, *adapter_args, **adapter_kwargs)
        @wraps(function)
        async def measured(*args, **kwargs):
            queued = perf_counter()
            metrics = Queries()
            timings = {}
            def execute():
                started = perf_counter()
                timings['queueMs'] = round((started - queued) * 1000, 3)
                try:
                    with query_stack(metrics):
                        return function(*args, **kwargs)
                finally:
                    timings['executionMs'] = round((perf_counter() - started) * 1000, 3)
            response = None
            try:
                response = await original_adapter(execute, *adapter_args, **adapter_kwargs)()
                return response
            finally:
                state = (response or {}).get('state', {})
                emit('ready_state_processed', operation='join' if kwargs.get('join') else 'state_recheck',
                     fixtureId=state.get('fixture_id', kwargs.get('fixture_id')),
                     seat=state.get('seat'), bothReady=state.get('both_ready'),
                     succeeded=(response or {}).get('type') == 'entry_state',
                     totalMs=round((perf_counter() - queued) * 1000, 3), **timings, **metrics.fields())
        return measured
    consumers.database_sync_to_async = adapter

    original_invalidate = consumers.ClubUpdatesConsumer.club_invalidate
    @wraps(original_invalidate)
    async def invalidate(self, event):
        counters = getattr(self, '_e2e_invalidations', None)
        if counters is None:
            self._e2e_invalidations = counters = {'count': 0, 'ms': 0.0}
        started = perf_counter()
        try:
            return await original_invalidate(self, event)
        finally:
            counters['count'] += 1
            counters['ms'] += (perf_counter() - started) * 1000
    consumers.ClubUpdatesConsumer.club_invalidate = invalidate

    original_send = consumers.ClubUpdatesConsumer.send_json
    @wraps(original_send)
    async def send_json(self, content, **kwargs):
        result = await original_send(self, content, **kwargs)
        if isinstance(content, dict) and content.get('type') == 'entry_state':
            state = content.get('state', {})
            emit('entry_state_sent', fixtureId=state.get('fixture_id'), seat=state.get('seat'),
                 bothReady=state.get('both_ready'))
        return result
    consumers.ClubUpdatesConsumer.send_json = send_json

    for method_name in ('receive_json', 'club_entry_changed'):
        original = getattr(consumers.ClubUpdatesConsumer, method_name)
        def decorate(function, name):
            @wraps(function)
            async def traced(self, event, **kwargs):
                binding = getattr(self, 'entry', None)
                is_join = name == 'receive_json' and isinstance(event, dict) and event.get('type') == 'entry_join'
                if not is_join and (name != 'club_entry_changed' or binding is None):
                    return await function(self, event, **kwargs)
                if not hasattr(self, '_e2e_invalidations'):
                    self._e2e_invalidations = {'count': 0, 'ms': 0.0}
                values = {'traceId': uuid.uuid4().hex, 'userId': self.scope['user'].pk,
                          'counters': self._e2e_invalidations}
                if binding:
                    values.update(tournamentId=binding[0], fixtureId=binding[1], seat=binding[2], attemptId=binding[3])
                if is_join:
                    attempt = event.get('attempt_id')
                    if not isinstance(attempt, str) or not re.fullmatch(r'[a-f0-9]{32}', attempt):
                        return await function(self, event, **kwargs)
                    values.update(attemptId=attempt)
                    for source, dest in (('tournament_id', 'tournamentId'), ('fixture_id', 'fixtureId')):
                        if type(event.get(source)) is int and event[source] > 0:
                            values[dest] = event[source]
                token = context.set(values)
                try:
                    emit('entry_join_received' if is_join else 'entry_change_received')
                    return await function(self, event, **kwargs)
                finally:
                    context.reset(token)
            return traced
        setattr(consumers.ClubUpdatesConsumer, method_name, decorate(original, method_name))

    def activated(sender, instance, created, update_fields=None, **_kwargs):
        if not instance.playable_at or (not created and update_fields is not None and 'playable_at' not in update_fields):
            return
        values = {'traceId': uuid.uuid4().hex, 'fixtureId': instance.pk}
        mode = instance._state.fields_cache.get('mode')
        if mode is not None:
            values['tournamentId'] = mode.tournament_id
        playable_at = instance.playable_at.isoformat()
        def committed():
            token = context.set(values)
            try:
                emit('fixture_available_committed', playableAt=playable_at)
            finally:
                context.reset(token)
        transaction.on_commit(committed)
    post_save.connect(activated, sender=Fixture, weak=False, dispatch_uid='e2e_entry_activation')


class AdmissionASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] == 'websocket' and path == '/ws/club/updates/':
            async def measured_receive():
                message = await receive()
                try:
                    payload = json.loads(message.get('text', ''))
                except (ValueError, TypeError):
                    return message
                if isinstance(payload, dict) and payload.get('type') == 'entry_join' and \
                        isinstance(payload.get('attempt_id'), str) and re.fullmatch(r'[a-f0-9]{32}', payload['attempt_id']):
                    values = {'attemptId': payload['attempt_id']}
                    for source, dest in (('tournament_id', 'tournamentId'), ('fixture_id', 'fixtureId')):
                        if type(payload.get(source)) is int and payload[source] > 0:
                            values[dest] = payload[source]
                    token = context.set(values)
                    try:
                        emit('club_entry_frame_received')
                    finally:
                        context.reset(token)
                return message
            return await self.application(scope, measured_receive, send)
        if scope['type'] == 'websocket' and re.fullmatch(r'/ws/game/[a-f0-9-]{36}/', path):
            token = context.set({'traceId': uuid.uuid4().hex, 'roomId': path.split('/')[3]})
            initial_sent = False
            async def measured_send(message):
                nonlocal initial_sent
                await send(message)
                if message['type'] == 'websocket.accept':
                    emit('game_socket_accepted')
                elif message['type'] == 'websocket.send' and not initial_sent:
                    try:
                        payload = json.loads(message.get('text', ''))
                    except (ValueError, TypeError):
                        return
                    if isinstance(payload, dict) and payload.get('type') == 'state_update' and payload.get('initial') is True:
                        initial_sent = True
                        emit('game_initial_state_sent')
            try:
                emit('game_connection_started')
                return await self.application(scope, receive, measured_send)
            finally:
                context.reset(token)
        if scope['type'] != 'http' or not (scope.get('path') == '/api/link/enter/' or re.fullmatch(
                r'/api/gamelink/tournament/\d+/play/', scope.get('path', ''))):
            return await self.application(scope, receive, send)
        values = {'traceId': uuid.uuid4().hex}
        token = context.set(values)
        started = perf_counter()
        try:
            emit('http_request_received')
            return await self.application(scope, receive, send)
        finally:
            emit('http_asgi_complete', totalMs=round((perf_counter() - started) * 1000, 3))
            context.reset(token)
