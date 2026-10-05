"""Run only through the prepared rehearsal container's normal entrypoint."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid
from decimal import Decimal


def require(condition, message):
    if not condition:
        raise ValueError(message)


def save(file, value):
    file.write_text(json.dumps(value, indent=2, default=str) + '\n', encoding='utf-8')
    file.chmod(0o600)


def main():
    kind, action = sys.argv[1:3]
    require(kind in ('game', 'tournaments'), 'Unknown rehearsal service')
    session = json.loads(Path('/opt/e2e/session.json').read_text())
    target = session['identity']
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
            and database['NAME'] == f'backgammon_{kind}' and database['USER'] == f'backgammon_{kind}',
            'Operation refuses any database outside the copied rehearsal')
    require(not settings.DEBUG, 'DEBUG must be disabled')
    require(not MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes()),
            'Pending rehearsal migrations')
    origin = (settings.GAMELINK_TOURNAMENTS_URL if kind == 'game' else settings.GAMELINK_BACKGAMMON_URL)
    require(origin == target['origin'] and settings.GAMELINK_ENABLED, 'Callbacks must use the test listener')
    require(not getattr(settings, 'ANALYSIS_SERVICE_URL', '') and os.environ.get('ANALYSIS_SERVICE_URL') == '',
            'Analysis must be disabled for this browser test')
    if kind == 'tournaments':
        require(not settings.TRANZILA_ENABLED and not settings.TRANZILA_PURCHASES_ENABLED,
                'Payments must be disabled in the rehearsal')
        require(settings.EMAIL_BACKEND == 'django.core.mail.backends.dummy.EmailBackend'
                and not settings.WEB_PUSH_PRIVATE_KEY, 'External notifications must be disabled')
        from frontend.models import Task
    else:
        from game.models import Task
    directory = Path('/data/e2e-audit')
    baseline_file = directory / f'baseline-{kind}.json'
    User = get_user_model()
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
        return {str(task.pk): {'status': task.status, 'attempts': task.attempts,
                'error_hash': hashlib.sha256(task.last_error.encode()).hexdigest() if task.last_error else ''}
                for task in Task.objects.exclude(name__contains='deliver_analysis')}

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION READ ONLY')
        if action == 'baseline':
            from django.db.models import Max
            save(baseline_file, {'session_id': target['session_id'], 'tasks': task_state(),
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
        changed_errors = [task_id for task_id, state in task_state().items()
                          if (state['error_hash'] or state['status'] in ('failed', 'blocked'))
                          and state != baseline['tasks'].get(task_id)]
        report = {'kind': kind, 'session_id': target['session_id'], 'run_id': summary['runId'],
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
            from tournaments.models import Tournament, Fixture, Participation, WalletTransaction
            from gamelink.models import GameLink
            tournament = Tournament.objects.get(pk=tournament_id)
            require(tournament.name == summary['tournamentName'] and tournament.results_confirmed_at
                    and not tournament.entry_deadline_paused, 'Tournament did not finish normally')
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
            champion = next(row for row in participants if row.podium_position == 1)
            require(len(awards) == 1 and awards[0].amount == Decimal('100.00')
                    and awards[0].pk == summary['final']['awardId']
                    and awards[0].user_id == champion.participant.user_id
                    and champion.participant_id == summary['final']['championId'], 'Prize or champion differs from browser proof')
            require(sorted(row.podium_position for row in participants if row.podium_position) == [1, 2], 'Unexpected podium')
            report.update(fixtures=len(fixtures), prize_awards=1, prize_amount='100.00')
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
