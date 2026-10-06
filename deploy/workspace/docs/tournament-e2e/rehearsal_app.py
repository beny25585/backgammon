"""Run only through the prepared rehearsal container's normal entrypoint."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid
from decimal import Decimal

from rehearsal_context import require_fresh_database_context
from rehearsal_integrations import ANALYSIS_URL, require_integration_context


def require(condition, message):
    if not condition:
        raise ValueError(message)


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
    if integration:
        require(getattr(settings, 'ANALYSIS_SERVICE_URL', '') == ANALYSIS_URL
                and os.environ.get('ANALYSIS_SERVICE_URL') == ANALYSIS_URL
                and os.environ.get('ANALYSIS_API_TOKEN'), 'Analysis must use the isolated internal service')
        if kind == 'game':
            require(os.environ.get('AI_SERVICE_URL') == ANALYSIS_URL, 'AI must use the internal analysis service')
    else:
        require(not getattr(settings, 'ANALYSIS_SERVICE_URL', '') and os.environ.get('ANALYSIS_SERVICE_URL') == '',
                'Analysis must be disabled unless explicitly activated')
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

    def task_state():
        tasks = Task.objects.all()
        if not integration:
            tasks = tasks.exclude(name__contains='deliver_analysis')
        return {str(task.pk): {'status': task.status, 'attempts': task.attempts,
                'error_hash': hashlib.sha256(task.last_error.encode()).hexdigest() if task.last_error else ''}
                for task in tasks}

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION READ ONLY')
        if action == 'baseline':
            from django.db.models import Max
            save(baseline_file, {'session_id': target['session_id'], 'database': database['NAME'], 'tasks': task_state(),
                                'max_user_id': User.objects.aggregate(value=Max('id'))['value'] or 0})
            print(f'{kind}: private task baseline captured; PostgreSQL context verified.')
            return
        require(action in ('audit', 'replay'), 'Unsupported rehearsal action')
        summary = json.loads((directory / 'tournament-summary.json').read_text())
        require(summary['status'] == 'passed' and summary['playerCount'] in (16, 32), 'Browser scenario did not pass')
        require(summary.get('targetSession') == target['session_id'], 'Browser session differs from this rehearsal')
        tournament_id = int(summary['tournamentId'])
        expected = summary['playerCount'] - 1
        matches = {item['fixtureId']: item for item in summary['matches']}
        require(len(matches) == expected, 'Incomplete browser fixture coverage')
        baseline = json.loads(baseline_file.read_text())
        require(baseline['session_id'] == target['session_id'], 'Wrong private baseline')
        require(baseline.get('database') == database['NAME'], 'Baseline belongs to a different database')
        changed_errors = [task_id for task_id, state in task_state().items()
                          if (state['error_hash'] or state['status'] in ('failed', 'blocked'))
                          and state != baseline['tasks'].get(task_id)]
        report = {'kind': kind, 'session_id': target['session_id'], 'run_id': summary['runId'],
                  'database': database['NAME'],
                  'tournament_id': tournament_id, 'changed_task_failures': changed_errors,
                  'baseline_error_tasks': sum(bool(row['error_hash']) for row in baseline['tasks'].values())}
        require(not changed_errors, 'New or changed background task failures; inspect private baseline and logs')
        if kind == 'game':
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
    if action == 'replay':
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
    report['passed'] = True
    save(directory / f'{summary["runId"]}-{kind}-{action}.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
