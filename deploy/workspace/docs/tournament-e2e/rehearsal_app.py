"""Run only through the prepared rehearsal container's normal entrypoint."""
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid
from decimal import Decimal

from rehearsal_context import require_fresh_database_context
from rehearsal_integrations import ANALYSIS_URL, require_integration_context


def require(condition, message):
    if not condition:
        raise ValueError(message)


def require_analysis_configuration(settings, environment, kind, enabled):
    # Match frontend.analysis_results: a missing/empty Django setting falls back
    # to the runtime environment supplied by the normal container entrypoint.
    url = getattr(settings, 'ANALYSIS_SERVICE_URL', '') or environment.get('ANALYSIS_SERVICE_URL', '')
    token = getattr(settings, 'ANALYSIS_API_TOKEN', '') or environment.get('ANALYSIS_API_TOKEN', '')
    if enabled:
        require(url == ANALYSIS_URL and environment.get('ANALYSIS_SERVICE_URL') == ANALYSIS_URL
                and token and environment.get('ANALYSIS_API_TOKEN'),
                'Analysis must use the isolated internal service')
        if kind == 'game':
            ai_url = getattr(settings, 'AI_SERVICE_URL', '') or environment.get('AI_SERVICE_URL', '')
            require(ai_url == ANALYSIS_URL and environment.get('AI_SERVICE_URL') == ANALYSIS_URL,
                    'AI must use the internal analysis service')
    else:
        require(not url and environment.get('ANALYSIS_SERVICE_URL') == '',
                'Analysis must be disabled unless explicitly activated')


def require_tournament_finished(tournament, expected_name):
    require(tournament.name == expected_name, 'Tournament name differs from browser proof')
    require(tournament.state == 'finished' and not tournament.entry_deadline_paused,
            'Tournament did not finish normally')


def require_tournament_podium(participants, observed_podium):
    podium = sorted((row for row in participants if row.podium_position is not None),
                    key=lambda row: row.podium_position)
    require([row.podium_position for row in podium] == [0, 1], 'Unexpected podium')
    require([row.participant_id for row in podium] == [row['id'] for row in observed_podium],
            'Tournament podium differs from browser proof')
    return podium[0]


def save(file, value):
    file.write_text(json.dumps(value, indent=2, default=str) + '\n', encoding='utf-8')
    file.chmod(0o600)


def safe_error(value):
    value = re.sub(r'-----BEGIN [^-]+-----.*?-----END [^-]+-----', '[redacted-key]', str(value), flags=re.S)
    value = re.sub(r'https?://[^\s\)<>"\']+', '[url]', value)
    value = re.sub(r'\bBearer\s+\S+', 'Bearer [redacted]', value, flags=re.I)
    value = re.sub(r'\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b', '[email]', value)
    value = re.sub(r'\b(?:eyJ)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted-jwt]', value)
    value = re.sub(r'((?:password|secret|token|ticket|authorization)[\w-]*[\"\']?\s*[:=]\s*)'
                   r'(?:[\"\'][^\"\']*[\"\']|[^\s,;]+)', r'\1[redacted]', value, flags=re.I)
    value = re.sub(r'(?<![\w-])[A-Za-z0-9_+/=-]{32,}(?![\w-])', '[redacted-value]', value)
    return value[:2000]


def task_status(task):
    error = task.last_error or ''
    return {'status': task.status, 'attempts': task.attempts,
            'error_hash': hashlib.sha256(error.encode()).hexdigest() if error else ''}


def task_audit_fields(kind):
    fields = ('id', 'name', 'status', 'attempts', 'last_error', 'created_at', 'updated_at', 'run_at')
    return fields + (('max_attempts', 'kwargs') if kind == 'game' else ())


def task_failures(tasks, baseline):
    rows = []
    for task in tasks:
        state = task_status(task)
        if not state['error_hash'] and task.status not in ('failed', 'blocked'):
            continue
        before = baseline.get(str(task.pk))
        rows.append({'id': str(task.pk), 'name': task.name, **state,
                     'max_attempts': getattr(task, 'max_attempts', None), 'created_at': task.created_at,
                     'updated_at': task.updated_at,
                     'run_at': task.run_at, 'error': safe_error(task.last_error or ''),
                     'before': before, 'changed_since_baseline': state != before})
    return rows


def analysis_failure_context(tasks, failures, browser_rooms):
    """Resolve only analysis match IDs; never include task arguments or event bodies."""
    from django.db.models import Max
    from game.models import Match, GameEvent
    by_id = {row['id']: row for row in failures}
    for task in tasks:
        row = by_id.get(str(task.pk))
        if row is None or task.name not in ('game.analysis.outbox.deliver_analysis',
                                           'game.analysis_outbox.deliver_analysis'):
            continue
        try:
            match_id = uuid.UUID(str(task.kwargs.get('match_id')))
        except (ValueError, AttributeError, TypeError):
            row['analysis_context'] = {'match_found': False, 'reason': 'missing_or_invalid_match_id'}
            continue
        match = Match.objects.select_related('room').filter(pk=match_id).first()
        context = {'match_id': str(match_id), 'match_found': match is not None}
        if match is not None and match.room is not None:
            context.update(room_id=str(match.room_id), belongs_to_browser_tournament=str(match.room_id) in browser_rooms,
                           room_sequence=match.room.last_sequence,
                           persisted_event_sequence=GameEvent.objects.filter(room_id=match.room_id)
                               .aggregate(value=Max('sequence'))['value'] or 0)
        row['analysis_context'] = context


@contextmanager
def audit_outcome(file, report):
    """A failed assertion must leave the same structured report as a success."""
    report['passed'] = False
    report['audit_id'] = uuid.uuid4().hex
    save(file, report)
    print('SERVER AUDIT REPORT: ' + str(file))
    try:
        yield
    except Exception as exc:
        report['failure'] = {'type': type(exc).__name__, 'message': safe_error(exc)}
        save(file, report)
        print(json.dumps(report, indent=2, default=str))
        raise
    else:
        report['passed'] = True
        report['stage'] = 'complete'
        save(file, report)
        print(json.dumps(report, indent=2, default=str))


def main():
    kind, action = sys.argv[1:3]
    require(kind in ('game', 'tournaments'), 'Unknown rehearsal service')
    session = json.loads(Path('/opt/e2e/session.json').read_text())
    target = session['identity']
    context = require_fresh_database_context(target)
    require(target['project'] == 'backgammon-rehearsal-20261005t184922z'
            and target['origin'] == 'https://38.247.146.17.nip.io:18443', 'Unexpected test target')
    sys.path.insert(0, os.getcwd())
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection, transaction
    from django.contrib.auth import get_user_model
    from django.db.migrations.executor import MigrationExecutor
    database = connection.settings_dict
    require(connection.vendor == 'postgresql' and database['HOST'] == 'postgres'
            and database['NAME'] == context['databases'][kind] and database['USER'] == f'backgammon_{kind}',
            'Operation refuses any database outside the fresh browser rehearsal')
    expected_redis = f'redis://redis:6379/{context["redis_databases"][kind]}'
    layer = settings.CHANNEL_LAYERS['default']
    hosts = [item.get('address') if isinstance(item, dict) else item for item in layer['CONFIG']['hosts']]
    require(os.environ.get('REDIS_URL') == expected_redis
            and layer['BACKEND'] == 'channels_redis.core.RedisChannelLayer' and hosts == [expected_redis],
            'Unexpected browser Redis channel configuration')
    require(not settings.DEBUG, 'DEBUG must be disabled')
    require(not MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes()),
            'Pending rehearsal migrations')
    origin = (settings.GAMELINK_TOURNAMENTS_URL if kind == 'game' else settings.GAMELINK_BACKGAMMON_URL)
    require(origin == target['origin'] and settings.GAMELINK_ENABLED, 'Callbacks must use the test listener')
    integration = require_integration_context(target)
    require_analysis_configuration(settings, os.environ, kind, enabled=bool(integration))
    if kind == 'tournaments':
        require(not settings.TRANZILA_ENABLED and not settings.TRANZILA_PURCHASES_ENABLED,
                'Payments must be disabled in the rehearsal')
        require(settings.EMAIL_BACKEND == 'django.core.mail.backends.dummy.EmailBackend', 'Email must remain disabled')
        if integration:
            from frontend.push import configured
            require(configured() and settings.WEB_PUSH_SUBJECT == target['origin'], 'Missing test-scoped Push configuration')
            require(settings.GOOGLE_CLIENT_ID, 'Google client ID must be configured')
        else:
            require(not settings.WEB_PUSH_PRIVATE_KEY, 'Push must be disabled unless explicitly activated')
        from frontend.models import Task
    else:
        from game.models import Task
    directory = Path('/data/e2e-audit')
    baseline_file = directory / f'baseline-{kind}.json'
    User = get_user_model()
    if action == 'integrations':
        require(integration, 'Integration readiness requires explicit activation')
        if kind == 'game':
            import httpx
            from game.engine import BackgammonEngine
            state = BackgammonEngine.get_initial_state()
            state.update(turn='white', phase='moving', dice=[3, 1], remaining=[3, 1])
            response = httpx.post(ANALYSIS_URL + '/api/v1/internal/bot/move/',
                json={'state': state, 'difficulty': 'hard'}, timeout=60,
                headers={'Authorization': 'Bearer ' + os.environ['ANALYSIS_API_TOKEN']})
            require(response.status_code == 200, 'Live AI endpoint did not evaluate the opening position')
            result = response.json()
            require(result.get('engine') == 'open_sage' and result.get('engine_version')
                    and len(result.get('board', [])) == 26 and result.get('moves'), 'Live AI response is incomplete')
            save(directory / 'readiness-ai.json', {'passed': True, 'session_id': target['session_id'],
                 'engine': result['engine'], 'engine_version': result['engine_version'],
                 'scope': 'Authenticated game-container to live AI HTTP evaluation; no match or result injected.'})
            print('Live Open Sage AI HTTP evaluation verified.')
            return
        from importlib.util import find_spec
        from django.utils import timezone
        from frontend.models import PushWorkerStatus
        from frontend.analysis_results import read_results
        require(find_spec('pywebpush') is not None, 'Push delivery library is missing')
        deadline = time.monotonic() + 45
        while not PushWorkerStatus.objects.filter(pk=1, expected_by__gt=timezone.now()).exists():
            require(time.monotonic() < deadline, 'Push worker did not publish a live heartbeat')
            time.sleep(2)
        require(isinstance(read_results('', [('staff', '1')]).get('matches'), list), 'Analysis results bridge is unavailable')
        from google.auth.transport.requests import Request  # noqa: F401
        from urllib.request import urlopen
        with urlopen('https://www.googleapis.com/oauth2/v1/certs', timeout=10) as response:
            require(bool(json.load(response)), 'Google verification certificates are unavailable')
        print('Authenticated analysis results bridge and live Push worker verified; device delivery remains a separate check.')
        return
    if action == 'seed':
        require(kind == 'tournaments', 'Only the rehearsal tournament administrator is seeded')
        admin = session['admin']
        require(admin['username'] == 'E2EAdmin_' + target['session_id'][:12], 'Unexpected administrator')
        existing = User.objects.filter(username=admin['username']).first()
        if existing:
            require(existing.is_superuser and existing.check_password(admin['password']), 'Administrator collision')
        else:
            User.objects.create_superuser(username=admin['username'], password=admin['password'],
                                          email=admin['username'].lower() + '@example.invalid')
        print('Rehearsal-only administrator ready; existing accounts unchanged.')
        return

    def audit_tasks():
        tasks = Task.objects.all()
        if not integration:
            tasks = tasks.exclude(name__contains='deliver_analysis')
        return tasks.only(*task_audit_fields(kind))

    if action == 'baseline':
        from django.db.models import Max
        from rehearsal_runtime import snapshot
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            save(baseline_file, {'session_id': target['session_id'], 'database': database['NAME'],
                                'tasks': {str(task.pk): task_status(task) for task in audit_tasks()},
                                'max_user_id': User.objects.aggregate(value=Max('id'))['value'] or 0,
                                'runtime': snapshot(kind)})
        print(f'{kind}: private task baseline captured; PostgreSQL context verified.')
        return
    require(action in ('audit', 'replay'), 'Unsupported rehearsal action')
    summary = json.loads((directory / 'tournament-summary.json').read_text())
    require(summary.get('targetSession') == target['session_id']
            and re.fullmatch(r'[A-Za-z0-9_-]{10,80}', summary.get('runId', '')), 'Invalid audit report identity')
    report = {'kind': kind, 'action': action, 'session_id': target['session_id'],
              'run_id': summary['runId'], 'database': database['NAME'], 'stage': 'browser_and_baseline'}
    report_file = directory / f'{summary["runId"]}-{kind}-{action}.json'
    with audit_outcome(report_file, report):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            require(summary['status'] == 'passed' and summary['playerCount'] in (16, 32), 'Browser scenario did not pass')
            require(summary.get('targetSession') == target['session_id'], 'Browser session differs from this rehearsal')
            tournament_id = int(summary['tournamentId'])
            expected = summary['playerCount'] - 1
            matches = {item['fixtureId']: item for item in summary['matches']}
            require(len(matches) == expected, 'Incomplete browser fixture coverage')
            baseline = json.loads(baseline_file.read_text())
            require(baseline['session_id'] == target['session_id'], 'Wrong private baseline')
            require(baseline.get('database') == database['NAME'], 'Baseline belongs to a different database')
            if integration and target.get('runtime_checks_version') == 1:
                require(summary.get('comprehensiveChecks') is True
                        and summary.get('backgroundWorkers', {}).get('passed') is True
                        and summary.get('scheduledStart', {}).get('completedByWorker') is True,
                        'The complete worker/scheduled-start browser proof is required for this release')
            tasks = list(audit_tasks())
            failures = task_failures(tasks, baseline['tasks'])
            if kind == 'game':
                analysis_failure_context(tasks, failures, {item['roomId'] for item in summary['matches']})
            changed_errors = [row['id'] for row in failures if row['changed_since_baseline']]
            report.update(tournament_id=tournament_id, changed_task_failures=changed_errors,
                          task_failure_details=failures,
                          baseline_error_tasks=sum(bool(row['error_hash']) for row in baseline['tasks'].values()))
            report['stage'] = 'background_tasks'
            if summary.get('comprehensiveChecks'):
                from rehearsal_runtime import progress, snapshot
                require(baseline.get('runtime'), 'Refresh the comprehensive baseline before this browser run')
                report['background_workers'] = progress(baseline['runtime'], snapshot(kind),
                                                        push_required=bool(integration))
            # Verify independent results and wallet accounting even when a worker failed.
            # The overall audit still fails, and duplicate-result writes remain gated.
            if kind == 'game':
                report['stage'] = 'game_results'
                from game.link.models import TournamentLink
                from game.models import GameState, Match, RoomPlayer
                links = list(TournamentLink.objects.filter(tournament_id=tournament_id, issuer='tournaments'))
                require(len(links) == expected and {link.fixture_id for link in links} == set(matches), 'Game links differ from browser fixtures')
                for link in links:
                    observed = matches[link.fixture_id]
                    require(str(link.room_id) == observed['roomId'] and link.result_status == 'delivered'
                            and link.delivered_at and link.result_body, 'Result has not been delivered for the observed room')
                    state = GameState.objects.get(room_id=link.room_id).state_data
                    winner = state.get('winner')
                    require(winner in ('white', 'black') and state.get('home', {}).get(winner) == 15
                            and state.get('gameEndReason') == 'move', 'Game did not end by natural bear-off')
                    recorded = list(Match.objects.filter(room_id=link.room_id))
                    require(len(recorded) == 1 and recorded[0].end_reason == 'move'
                            and recorded[0].winner == winner, 'Persisted match differs from natural completion')
                    require(set(RoomPlayer.objects.filter(room_id=link.room_id).values_list('color', flat=True))
                            == {'white', 'black'}, 'Room seats are incomplete')
                report['natural_games'] = len(links)
                frozen = [(link.fixture_id, link.result_body) for link in links]
            else:
                report['stage'] = 'tournament_wallet'
                from tournaments.models import Tournament, Fixture, Participation, WalletTransaction, TournamentRegistration
                from gamelink.models import GameLink
                tournament = Tournament.objects.get(pk=tournament_id)
                require_tournament_finished(tournament, summary['tournamentName'])
                participants = list(Participation.objects.filter(tournament_id=tournament_id).select_related('participant__user'))
                suffix = ''.join(character for character in summary['runId'] if character.isalnum())[-12:]
                require(len(participants) == summary['playerCount'] and all(
                    row.participant.user_id > baseline['max_user_id']
                    and row.participant.user.username.startswith('E2E' + suffix + 'P') for row in participants),
                    'Tournament includes an account outside this browser run')
                fixtures = list(Fixture.objects.filter(mode__tournament_id=tournament_id))
                require(len(fixtures) == expected and {row.pk for row in fixtures} == set(matches), 'Unexpected tournament fixture coverage')
                for fixture in fixtures:
                    observed = matches[fixture.pk]
                    require(fixture.auto_confirmed and not fixture.admin_result and fixture.winner
                            and fixture.winner.pk == observed['winnerId']
                            and (fixture.score1, fixture.score2) == (observed['score1'], observed['score2']),
                            'Tournament winner or score differs from observed game')
                    link = GameLink.objects.get(fixture_id=fixture.pk)
                    require(link.status == 'completed' and link.external_room_id == observed['roomId']
                            and link.raw_result, 'Tournament callback belongs to a different room')
                awards = list(WalletTransaction.objects.filter(tournament_id=tournament_id, kind='tournament_prize'))
                champion = require_tournament_podium(participants, summary['final']['podium'])
                require(len(awards) == 1 and awards[0].amount == Decimal('100.00')
                        and awards[0].pk == summary['final']['awardId']
                        and awards[0].user_id == champion.participant.user_id
                        and champion.participant_id == summary['final']['championId'], 'Prize or champion differs from browser proof')
                report.update(fixtures=len(fixtures), prize_awards=1, prize_amount='100.00')
                fee = Decimal(str(summary.get('entryFeeCoins', 0)))
                require(tournament.entry_fee == fee, 'Entry fee differs from the browser tournament')
                if fee > 0:
                    user_ids = {row.participant.user_id for row in participants}
                    charges = list(WalletTransaction.objects.filter(tournament_id=tournament_id, kind='tournament_entry'))
                    require(len(charges) == summary['playerCount'] and {row.user_id for row in charges} == user_ids
                            and all(row.amount == -fee for row in charges), 'Entry fees are missing or duplicated')
                    require(not WalletTransaction.objects.filter(tournament_id=tournament_id, kind='tournament_refund').exists(),
                            'Completed tournament contains an unexpected entry refund')
                    registrations = TournamentRegistration.objects.filter(tournament_id=tournament_id)
                    require(registrations.count() == len(user_ids) and all(row.payment_status == 'paid' for row in registrations),
                            'Registration payment state differs from the ledger')
                    balances = summary['final'].get('balances', [])
                    require(len(balances) == len(user_ids) and {row['userId'] for row in balances} == user_ids,
                            'Missing per-player wallet proof')
                    for observed_balance in balances:
                        expected_balance = Decimal(str(observed_balance['initial'])) - fee
                        if observed_balance['userId'] == champion.participant.user_id:
                            expected_balance += Decimal('100.00')
                        actual_balance = WalletTransaction.balance_for_user(User.objects.get(pk=observed_balance['userId']))
                        require(actual_balance == expected_balance == Decimal(str(observed_balance['final'])),
                                'Persisted player balance differs from entry/prize accounting')
                    require(summary.get('entryFees', {}).get('registrationReplayVerified') is True,
                            'Missing duplicate-registration browser proof')
                    report.update(entry_fee=str(fee), entry_debits=len(charges), collected_coins=str(fee * len(charges)),
                                  all_player_balances_verified=True)
        report['results_verified'] = True
        report['stage'] = 'background_tasks'
        require(not changed_errors, 'New or changed background task failures; inspect task_failure_details in this report')
        if summary.get('comprehensiveChecks'):
            require(report['background_workers']['passed'], 'Background worker progress failed: ' +
                    '; '.join(report['background_workers']['issues']))
        if action == 'replay':
            report['stage'] = 'duplicate_results'
            require(kind == 'game', 'Duplicate-result replay requires the game container')
            import httpx
            from game.link.signing import sign_result_body
            acknowledgements = []
            with httpx.Client(timeout=10, follow_redirects=False) as client:
                identity = client.get(target['origin'] + '/__e2e__/identity')
                require(identity.status_code == 200 and identity.json() == target, 'Replay target identity changed')
                for fixture_id, body in frozen:
                    raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
                    for repeat in (1, 2):
                        timestamp, nonce = str(int(time.time())), uuid.uuid4().hex
                        response = client.post(target['origin'] + '/api/gamelink/result/', content=raw, headers={
                            'Content-Type': 'application/json', 'X-Gamelink-Timestamp': timestamp,
                            'X-Gamelink-Nonce': nonce, 'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
                            'X-Gamelink-Issuer': settings.GAMELINK_ISSUER})
                        require(response.status_code == 200 and response.json().get('status') == 'already_recorded',
                                'Unchanged duplicate result was not acknowledged idempotently')
                        acknowledgements.append({'fixture_id': fixture_id, 'repeat': repeat, 'status': 'already_recorded'})
            report['acknowledgements'] = acknowledgements


if __name__ == '__main__':
    main()
