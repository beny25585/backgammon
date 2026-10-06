"""Join safe entry evidence by identity; never subtract PC and server clocks."""
from datetime import datetime
import math
import re
import json


PHASES = {'operation_complete', 'http_processing_complete', 'http_asgi_complete',
          'http_request_received', 'http_processing_started',
          'ready_state_processed', 'entry_join_received', 'entry_change_received',
          'entry_change_published', 'entry_change_publish_complete',
          'entry_state_sent', 'presence_join_saved', 'pair_authorization_committed',
          'fixture_available_committed', 'game_seat_committed', 'room_started_committed',
          'club_entry_frame_received', 'game_socket_accepted', 'game_initial_state_sent', 'game_connection_started'}
OPERATIONS = {'game_enter', 'ticket_request', 'verify_ticket', 'resolve_identity', 'find_or_create_room',
              'start_full_room', 'check_active_room', 'resolve_current_fixture', 'issue_ticket', 'authorize_pair',
              'join', 'state_recheck'}
NUMBERS = {'queueMs', 'executionMs', 'totalMs', 'sqlCount', 'sqlMs', 'lockStatementCount',
           'lockStatementMs', 'invalidationCount', 'invalidationMs', 'status'}


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)', value):
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    except ValueError:
        return None


def elapsed(end, start):
    return round(end - start, 3) if end is not None and start is not None and end >= start else None


def parse_events(text, session_id, service):
    result = []
    for line in text.splitlines():
        if 'E2E_ADMISSION ' not in line:
            continue
        try:
            row = json.loads(line.split('E2E_ADMISSION ', 1)[1])
        except (ValueError, TypeError):
            continue
        if not isinstance(row, dict) or row.get('sessionId') != session_id or row.get('service') != service \
                or row.get('phase') not in PHASES or instant(row.get('serverAt')) is None:
            continue
        safe = {key: row[key] for key in ('phase', 'sessionId', 'service', 'serverAt')}
        for key in ('tournamentId', 'fixtureId', 'userId'):
            if type(row.get(key)) is int and row[key] > 0:
                safe[key] = row[key]
        for key in ('traceId', 'attemptId', 'notificationId'):
            if isinstance(row.get(key), str) and re.fullmatch(r'[a-f0-9]{32}', row[key]):
                safe[key] = row[key]
        if isinstance(row.get('roomId'), str) and re.fullmatch(r'[a-f0-9-]{36}', row['roomId']):
            safe['roomId'] = row['roomId']
        if row.get('seat') in ('p1', 'p2'):
            safe['seat'] = row['seat']
        if row.get('operation') in OPERATIONS:
            safe['operation'] = row['operation']
        if instant(row.get('playableAt')) is not None:
            safe['playableAt'] = row['playableAt']
        if instant(row.get('publishedAt')) is not None:
            safe['publishedAt'] = row['publishedAt']
        for key in NUMBERS:
            if type(row.get(key)) in (int, float) and math.isfinite(row[key]) and row[key] >= 0:
                safe[key] = row[key]
        for key in ('bothReady', 'succeeded'):
            if type(row.get(key)) is bool:
                safe[key] = row[key]
        result.append(safe)
    return result


def distribution(values):
    values = sorted(value for value in values if type(value) in (int, float) and math.isfinite(value))
    if not values:
        return {'count': 0}
    return {'count': len(values), 'mean': round(sum(values) / len(values), 3),
            'p95': values[math.ceil(len(values) * .95) - 1], 'max': values[-1]}


def build_report(summary, events, availability=()):
    fixture_ids = {row['fixtureId'] for row in summary.get('matches', [])}
    fixture_ids.update(row['fixtureId'] for row in summary.get('entryFlowEvents', []) if type(row.get('fixtureId')) is int)
    target_events = [row for row in events if row.get('fixtureId') in fixture_ids or row.get('tournamentId') == summary['tournamentId']]
    traces = {row['traceId'] for row in target_events if 'traceId' in row}
    rooms = {row['roomId'] for row in target_events if 'roomId' in row}
    attempts = {row['attemptId'] for row in target_events if 'attemptId' in row}
    relevant = [row for row in events if row.get('fixtureId') in fixture_ids or row.get('tournamentId') == summary['tournamentId'] or row.get('traceId') in traces or
                row.get('roomId') in rooms or row.get('attemptId') in attempts]
    relevant.sort(key=lambda row: instant(row['serverAt']))
    playable = {row['fixtureId']: instant(row.get('playableAt')) for row in availability
                if type(row.get('fixtureId')) is int and row['fixtureId'] in fixture_ids}
    fixtures = []
    for fixture_id in sorted(fixture_ids):
        rows = [row for row in relevant if row.get('fixtureId') == fixture_id]
        first = lambda phase: next((instant(row['serverAt']) for row in rows if row['phase'] == phase), None)
        grant_at = first('pair_authorization_committed')
        presence = {}
        for row in rows:
            if row['phase'] == 'presence_join_saved' and row.get('seat') in ('p1', 'p2'):
                presence.setdefault(row['seat'], instant(row['serverAt']))
        seats = []
        for seat in ('p1', 'p2'):
            own = [row for row in rows if row.get('seat') == seat]
            seated_at = next((instant(row['serverAt']) for row in own if row['phase'] == 'game_seat_committed'), None)
            ready_at = next((instant(row['serverAt']) for row in own if row['phase'] == 'entry_state_sent' and row.get('bothReady')), None)
            attempt_id = next((row.get('attemptId') for row in own if row['phase'] == 'presence_join_saved'), None)
            attempt = [row for row in relevant if attempt_id and row.get('attemptId') == attempt_id]
            frame_at = next((instant(row['serverAt']) for row in attempt if row['phase'] == 'club_entry_frame_received'), None)
            dispatch_at = next((instant(row['serverAt']) for row in attempt if row['phase'] == 'entry_join_received'), None)
            state_calls = [row for row in attempt if row['phase'] == 'ready_state_processed']
            seats.append({'seat': seat, 'attemptId': attempt_id, 'serverPhasesMs': {
                'asgiReceiveToConsumerMs': elapsed(dispatch_at, frame_at),
                'individualPresenceToAuthorizationMs': elapsed(grant_at, presence.get(seat)),
                'authorizationToReadySendMs': elapsed(ready_at, grant_at),
                'authorizationToCommittedSeatMs': elapsed(seated_at, grant_at),
            }, 'stateCalls': len(state_calls), 'stateSqlCount': sum(row.get('sqlCount', 0) for row in state_calls),
                'stateQueueMs': distribution([row.get('queueMs') for row in state_calls]),
                'stateExecutionMs': distribution([row.get('executionMs') for row in state_calls]),
                'stateLockStatementMs': distribution([row.get('lockStatementMs') for row in state_calls])})
        fixtures.append({'fixtureId': fixture_id, 'serverAvailableCommittedAt': first('fixture_available_committed'),
                         'serverPlayableStoredAt': playable.get(fixture_id),
                         'pairAuthorizationCommittedAt': grant_at,
                         'lastPresenceToAuthorizationMs': elapsed(grant_at, max(presence.values()) if len(presence) == 2 else None),
                         'seats': seats})
    requests = []
    for trace_id in sorted(traces):
        rows = [row for row in relevant if row.get('traceId') == trace_id]
        processed = next((row for row in rows if row['phase'] == 'http_processing_complete'), None)
        if not processed:
            continue
        timestamp = lambda phase: next((instant(row['serverAt']) for row in rows if row['phase'] == phase), None)
        requests.append({'traceId': trace_id, 'fixtureId': processed.get('fixtureId'),
                         'seat': processed.get('seat'), 'operation': processed.get('operation'),
                         'status': processed.get('status'), 'serverPhasesMs': {
                             'asgiToSyncMiddlewareMs': elapsed(timestamp('http_processing_started'), timestamp('http_request_received')),
                             'processingMs': processed.get('executionMs'),
                             'asgiTotalMs': next((row.get('totalMs') for row in rows if row['phase'] == 'http_asgi_complete'), None)},
                         'sqlCount': processed.get('sqlCount'), 'sqlMs': processed.get('sqlMs'),
                         'operations': [row for row in rows if row['phase'] == 'operation_complete']})
    connections = []
    for trace_id in sorted({row['traceId'] for row in relevant if row['phase'] == 'game_connection_started' and 'traceId' in row}):
        rows = [row for row in relevant if row.get('traceId') == trace_id]
        timestamp = lambda phase: next((instant(row['serverAt']) for row in rows if row['phase'] == phase), None)
        connection_at = timestamp('game_connection_started')
        accepted_at = timestamp('game_socket_accepted')
        connections.append({'traceId': trace_id, 'roomId': rows[0].get('roomId'),
                            'serverPhasesMs': {'connectionToAcceptMs': elapsed(accepted_at, connection_at),
                                              'acceptToInitialStateMs': elapsed(timestamp('game_initial_state_sent'), accepted_at)}})
    sql_rows = [row for row in relevant if row['phase'] in ('ready_state_processed', 'http_processing_complete')]
    metrics = {}
    for operation in sorted({row.get('operation', 'unknown') for row in sql_rows}):
        rows = [row for row in sql_rows if row.get('operation', 'unknown') == operation]
        metrics[operation] = {metric: distribution([row.get(metric) for row in rows])
                              for metric in ('queueMs', 'executionMs', 'sqlMs', 'sqlCount', 'lockStatementMs')}
    browser = summary.get('entryFlowEvents', [])
    publications = {row['notificationId']: row for row in relevant
                    if row['phase'] == 'entry_change_publish_complete'
                    and row.get('succeeded') is True and 'notificationId' in row}
    notifications = []
    for row in relevant:
        if row['phase'] != 'entry_change_received':
            continue
        publication = publications.get(row.get('notificationId'), {})
        notifications.append({
            'notificationId': row.get('notificationId'), 'fixtureId': row.get('fixtureId'),
            'seat': row.get('seat'), 'traceId': row.get('traceId'),
            'serverPhasesMs': {
                'publishToHandlerMs': elapsed(instant(row['serverAt']), instant(row.get('publishedAt'))),
                'publishCallMs': publication.get('executionMs'),
                'publishCompleteToHandlerMs': elapsed(instant(row['serverAt']), instant(publication.get('serverAt'))),
            },
        })
    return {'version': 1, 'runId': summary['runId'], 'tournamentId': summary['tournamentId'],
            'sessionId': summary['targetSession'], 'browserClock': 'PC epoch milliseconds',
            'serverClock': 'server UTC epoch milliseconds', 'limitations': [
                'Never subtract browser and server clocks. Link by attemptId, fixture/seat and serverTraceId.',
                'SQL/lock statement durations include database execution, network and waits; pure lock waiting is not isolated.',
                'Nested operation spans overlap; only request/state-call spans contribute SQL totals.',
                'Availability callbacks observe a committed playable fixture; a restart or already-playable save may be a later observation.',
                'serverPlayableStoredAt is the persisted assignment timestamp, read once after the run; it is not a commit timestamp.',
                'lastPresenceToAuthorizationMs requires both distinct seats; opponent wait is not processing latency.',
                'Notification timing uses server wall clocks, which require alignment across hosts. Publication completion is not broker arrival; a handler may start before group_send returns.',
                'Missing evidence stays null. Logging and browser observers add some measurement overhead.'],
            'coverage': {'serverEvents': len(relevant), 'browserEvents': len(browser),
                         'fixtures': len(fixtures), 'fixturesWithPairCommit': sum(row['pairAuthorizationCommittedAt'] is not None for row in fixtures),
                         'seatsWithCommit': sum(seat['serverPhasesMs']['authorizationToCommittedSeatMs'] is not None
                                               for row in fixtures for seat in row['seats'])},
            'serverMetrics': metrics, 'fixtures': fixtures, 'requests': requests, 'gameConnections': connections,
            'entryNotifications': notifications,
            'serverEvents': relevant,
            'browserEvents': browser, 'requestCorrelations': [
                {key: row.get(key) for key in ('label', 'path', 'startedAt', 'elapsedMs', 'serverTraceId')}
                for row in summary.get('requests', []) if row.get('serverTraceId')]}
