"""Run-owned data receipts and cleanup, only in a pinned copied candidate.

The host stops candidate writers before discovery/deletion. No time-range,
prefix, database reset, Redis flush or global task deletion is used.
"""
import json
import os
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime, timezone

from rehearsal_context import require_browser_database_context


def require(value, message):
    if not value:
        raise ValueError(message)


def read(file):
    require(file.is_file() and not file.is_symlink(), 'Missing or unsafe load receipt: ' + file.name)
    return json.loads(file.read_text(encoding='utf-8'))


def save(file, value):
    require(not file.is_symlink(), 'Unsafe load receipt')
    temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        temporary.chmod(0o600)
        json.dump(value, stream, indent=2, default=str)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(file)


def validate_plan(plan, identity):
    require(re.fullmatch(r'[A-Za-z0-9_-]{10,80}', plan.get('runId', ''))
            and plan.get('targetSession') == identity['session_id']
            and plan.get('playerCount') in (16, 32), 'Load plan identity differs')
    suffix = re.sub(r'[^a-zA-Z0-9]', '', plan['runId'])[-12:]
    require(plan.get('usernames') == [f'E2E{suffix}P{index + 1}' for index in range(plan['playerCount'])]
            and plan.get('tournamentName') == 'Disposable E2E ' + suffix,
            'Load plan must describe the exact browser accounts and tournament')
    return plan


def primary_keys(queryset):
    return {str(value) for value in queryset.values_list('pk', flat=True)}


def baseline_models():
    from django.apps import apps
    return [model for model in apps.get_models() if model._meta.managed and not model._meta.proxy]


def safe_delete(queryset, baseline, counts):
    """Check Django cascades and SET_NULL effects before invoking any signal."""
    from django.db.models.deletion import Collector
    collector = Collector(using=queryset.db)
    collector.collect(queryset)

    def new_rows(model, rows):
        old = set(baseline['models'].get(model._meta.label_lower, []))
        require(not old.intersection(rows), 'Cleanup would change pre-existing ' + model._meta.label_lower)

    for model, rows in collector.data.items():
        new_rows(model, {str(row.pk) for row in rows})
    for rows in collector.fast_deletes:
        new_rows(rows.model, primary_keys(rows))
    for (field, _), batches in collector.field_updates.items():
        for rows in batches:
            values = primary_keys(rows) if hasattr(rows, 'values_list') else {str(row.pk) for row in rows}
            new_rows(field.model, values)
    # Use the checked collector, including the application's normal delete signals.
    _, deleted = collector.delete()
    for label, amount in deleted.items():
        counts[label] = counts.get(label, 0) + amount


def tournament_scope(plan, baseline, session):
    from django.conf import settings
    from django.contrib.auth import get_user_model
    from django.db.models import Q
    from tournaments.models import Tournament, Participant, Fixture, Participation, TournamentRegistration, WalletTransaction
    from gamelink.models import LinkedAccount, GameLink, IssuedTicket
    from django.contrib.sessions.models import Session
    User = get_user_model()
    users = list(User.objects.filter(username__in=plan['usernames']))
    require(all(not user.is_staff and not user.is_superuser and
                user.email == user.username.lower() + '@example.invalid' for user in users),
            'A planned account has an unexpected identity or privilege')
    ids = [user.pk for user in users]
    require(not set(map(str, ids)).intersection(baseline['models'].get(User._meta.label_lower, [])),
            'A load account existed before the run')
    tournaments = list(Tournament.objects.filter(name=plan['tournamentName']))
    require(len(tournaments) <= 1, 'Ambiguous load tournament')
    tournament = tournaments[0] if tournaments else None
    tid = tournament.pk if tournament else None
    if tournament:
        require(tournament.creator and tournament.creator.username == session['admin']['username']
                and str(tid) not in baseline['models'].get('tournaments.tournament', []),
                'Tournament is not owned by this load session')
    participants = Participant.objects.filter(user_id__in=ids)
    pids = list(participants.values_list('pk', flat=True))
    fixtures = Fixture.objects.filter(mode__tournament_id=tid) if tid else Fixture.objects.none()
    fids = list(fixtures.values_list('pk', flat=True))
    require(not fixtures.exclude(Q(player1_id__in=pids) | Q(player1_id__isnull=True)).exists()
            and not fixtures.exclude(Q(player2_id__in=pids) | Q(player2_id__isnull=True)).exists(),
            'Tournament contains an unrelated player')
    require(not Fixture.objects.filter(Q(player1_id__in=pids) | Q(player2_id__in=pids)).exclude(pk__in=fids).exists()
            and not Participation.objects.filter(participant_id__in=pids).exclude(tournament_id=tid).exists()
            and not TournamentRegistration.objects.filter(participant_id__in=pids).exclude(tournament_id=tid).exists(),
            'A test participant is also used outside this run')
    wallet = WalletTransaction.objects.filter(Q(user_id__in=ids) | Q(tournament_id=tid)) if tid else WalletTransaction.objects.filter(user_id__in=ids)
    require(not wallet.exclude(user_id__in=ids).exists()
            and not wallet.exclude(Q(tournament_id=tid) | Q(tournament_id__isnull=True)).exists()
            and not wallet.filter(head_to_head_table__isnull=False).exists(), 'Wallet scope includes unrelated activity')
    links = GameLink.objects.filter(fixture_id__in=fids)
    administrator = User.objects.filter(username=session['admin']['username']).first()
    if administrator:
        require(administrator.is_superuser and administrator.check_password(session['admin']['password'])
                and str(administrator.pk) not in baseline['models'].get(User._meta.label_lower, []),
                'Session administrator existed before the run or differs')
    session_users = set(map(str, ids + ([administrator.pk] if administrator else [])))
    session_ids = [row.pk for row in Session.objects.all() if str(row.get_decoded().get('_auth_user_id')) in session_users]
    return {'tournamentId': tid, 'userIds': ids, 'adminId': administrator.pk if administrator else None,
            'sessionIds': session_ids, 'participantIds': pids, 'fixtureIds': fids,
            'roomIds': [value for value in links.values_list('external_room_id', flat=True) if value],
            'externalIds': list(map(str, LinkedAccount.objects.filter(user_id__in=ids).values_list('external_id', flat=True))),
            'ticketIds': list(map(str, IssuedTicket.objects.filter(game_link__in=links).values_list('jti', flat=True))),
            'issuer': settings.GAMELINK_ISSUER}


def game_scope(tournament, baseline):
    from django.db.models import Q
    from django.contrib.auth import get_user_model
    from game.models import GameRoom, RoomPlayer, Match, Task
    from game.link.models import TournamentLink, LinkedIdentity
    issuer = tournament['issuer']
    links = TournamentLink.objects.filter(issuer=issuer, tournament_id=tournament['tournamentId']) \
        if tournament['tournamentId'] else TournamentLink.objects.none()
    require(not links.exclude(fixture_id__in=tournament['fixtureIds']).exists(), 'Unrelated game fixture')
    room_ids = {str(value) for value in links.values_list('room_id', flat=True)}
    require(set(tournament['roomIds']).issubset(room_ids), 'Tournament/game room mapping differs')
    identities = LinkedIdentity.objects.filter(issuer=issuer, external_id__in=tournament['externalIds'])
    user_ids = list(identities.values_list('user_id', flat=True))
    User = get_user_model()
    require(not set(map(str, user_ids)).intersection(baseline['models'].get(User._meta.label_lower, [])),
            'Linked account existed before this run')
    require(not LinkedIdentity.objects.filter(user_id__in=user_ids).exclude(pk__in=identities.values('pk')).exists(),
            'Linked user is shared with another identity')
    require(not RoomPlayer.objects.filter(room_id__in=room_ids).exclude(player__user_id__in=user_ids).exists()
            and not RoomPlayer.objects.filter(player__user_id__in=user_ids).exclude(room_id__in=room_ids).exists(),
            'A room or game account is shared outside the run')
    matches = Match.objects.filter(room_id__in=room_ids)
    mids = {str(value) for value in matches.values_list('pk', flat=True)}
    require(not Match.objects.filter(Q(white_player__user_id__in=user_ids) | Q(black_player__user_id__in=user_ids))
            .exclude(pk__in=mids).exists(), 'Game account has another match')
    require(not room_ids.intersection(baseline['models'].get('game.gameroom', []))
            and not mids.intersection(baseline['models'].get('game.match', [])), 'Game data existed before this run')
    link_ids = {str(value) for value in links.values_list('pk', flat=True)}
    task_ids = []
    for task in Task.objects.all().only('pk', 'kwargs', 'delivery_payload'):
        kwargs = task.kwargs or {}
        require(isinstance(kwargs, dict), 'Unexpected task argument structure')
        body = kwargs.get('body') if isinstance(kwargs.get('body'), dict) else {}
        payload = task.delivery_payload if isinstance(task.delivery_payload, dict) else {}
        if (str(kwargs.get('link_id')) in link_ids or str(kwargs.get('match_id')) in mids
                or str(kwargs.get('room_id')) in room_ids or str(body.get('room_id')) in room_ids
                or str(payload.get('room_id')) in room_ids):
            task_ids.append(str(task.pk))
    return {'roomIds': sorted(room_ids), 'matchIds': sorted(mids), 'userIds': user_ids,
            'taskIds': task_ids, 'ticketIds': tournament['ticketIds'], 'issuer': issuer}


def operation(kind, action, session, directory):
    from django.apps import apps
    from django.db import connection, transaction
    from django.conf import settings
    context = require_browser_database_context(session['identity'])
    require(context['purpose'] == 'copied-browser-e2e', 'Load cleanup requires the copied candidate opt-in')
    database = connection.settings_dict
    require(connection.vendor == 'postgresql' and database['HOST'] == 'postgres'
            and database['NAME'] == context['databases'][kind] and database['USER'] == 'backgammon_' + kind
            and not settings.DEBUG, 'Load operation refuses a different database')
    with connection.cursor() as cursor:
        cursor.execute("SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()")
        require(cursor.fetchone()[0] == context['markers'][kind], 'Load database marker changed')
    plan = validate_plan(read(directory / 'load-plan.json'), session['identity'])
    prefix = directory / ('load-' + plan['runId'] + '-' + kind)
    baseline_file = prefix.with_name(prefix.name + '-baseline.json')
    scope_file = prefix.with_name(prefix.name + '-scope.json')
    report_file = prefix.with_name(prefix.name + '-cleanup.json')
    if action == 'begin':
        require(not baseline_file.exists(), 'Run baseline already exists; clean or resume the existing run')
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            if kind == 'tournaments':
                from django.contrib.auth import get_user_model
                from tournaments.models import Tournament, Participant
                require(not get_user_model().objects.filter(username__in=plan['usernames']).exists()
                        and not get_user_model().objects.filter(username=session['admin']['username']).exists()
                        and not Participant.objects.filter(name__in=plan['usernames']).exists()
                        and not Tournament.objects.filter(name=plan['tournamentName']).exists(), 'Load name collision')
            save(baseline_file, {'runId': plan['runId'], 'targetSession': plan['targetSession'],
                'models': {model._meta.label_lower: sorted(primary_keys(model._base_manager.all())) for model in baseline_models()}})
        return
    baseline = read(baseline_file)
    require(baseline['runId'] == plan['runId'] and baseline['targetSession'] == plan['targetSession'], 'Baseline differs')
    if action == 'discover':
        # A partially completed cleanup retains the complete original scope.
        if scope_file.exists():
            saved = read(scope_file)
            require(saved['runId'] == plan['runId'] and saved['targetSession'] == plan['targetSession'], 'Scope receipt differs')
            return
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            if kind == 'tournaments':
                scope = tournament_scope(plan, baseline, session)
                nonce_file = directory / ('load-' + plan['runId'] + '-nonces.ndjson')
                require(not nonce_file.is_symlink(), 'Unsafe callback receipt')
                scope['nonces'] = sorted({json.loads(line)['nonce'] for line in nonce_file.read_text().splitlines()}) \
                    if nonce_file.exists() else []
                ticket_file = directory / ('load-' + plan['runId'] + '-tickets.ndjson')
                require(not ticket_file.is_symlink(), 'Unsafe ticket receipt')
                if ticket_file.exists():
                    scope['ticketIds'] = sorted(set(scope['ticketIds']) |
                                               {json.loads(line)['jti'] for line in ticket_file.read_text().splitlines()})
            elif kind == 'game':
                scope = game_scope(read(directory / ('load-' + plan['runId'] + '-tournaments-scope.json')), baseline)
            else:
                from analysis.models import MatchAnalysis
                game = read(directory / ('load-' + plan['runId'] + '-game-scope.json'))
                rows = MatchAnalysis.objects.filter(source_room_id__in=game['roomIds'])
                require(not rows.exclude(source_match_id__in=game['matchIds']).exists(), 'Analysis belongs to another match')
                scope = {'analysisIds': list(map(str, rows.values_list('pk', flat=True)))}
            scope.update(runId=plan['runId'], targetSession=plan['targetSession'])
            save(scope_file, scope)
        return
    require(action in ('cleanup', 'verify'), 'Unknown load operation')
    scope = read(scope_file)
    require(scope['runId'] == plan['runId'] and scope['targetSession'] == plan['targetSession'], 'Scope receipt differs')
    if action == 'verify':
        if kind == 'analysis':
            roots = [('analysis.MatchAnalysis', {'pk__in': scope['analysisIds']})]
        elif kind == 'game':
            roots = [('game.Task', {'pk__in': scope['taskIds']}), ('game.RedeemedTicket', {'jti__in': scope['ticketIds'], 'issuer': scope['issuer']}),
                     ('game.Match', {'pk__in': scope['matchIds']}), ('game.GameRoom', {'pk__in': scope['roomIds']})]
        else:
            roots = [('tournaments.Tournament', {'pk': scope['tournamentId']}),
                     ('tournaments.Participant', {'pk__in': scope['participantIds']}),
                     ('gamelink.SeenNonce', {'nonce__in': scope['nonces']}), ('sessions.Session', {'pk__in': scope['sessionIds']})]
        from django.contrib.auth import get_user_model
        if kind != 'analysis':
            require(not get_user_model().objects.filter(pk__in=scope['userIds']).exists(), 'Test accounts remain after cleanup')
        if kind == 'tournaments':
            require(not get_user_model().objects.filter(pk=scope['adminId']).exists(), 'Test administrator remains')
        require(not any(apps.get_model(label)._base_manager.filter(**filters).exists() for label, filters in roots),
                'Run-owned records remain after cleanup')
        return
    report = {'runId': plan['runId'], 'targetSession': plan['targetSession'], 'kind': kind,
              'passed': False, 'deleted': {}, 'preExistingRowsProtected': True}
    if report_file.exists():
        previous = read(report_file)
        require(previous['runId'] == plan['runId'] and previous['targetSession'] == plan['targetSession'], 'Cleanup receipt differs')
        report['previousAttempts'] = [*previous.get('previousAttempts', []),
            {key: value for key, value in previous.items() if key != 'previousAttempts'}]
    save(report_file, report)
    try:
        with transaction.atomic():
            counts = report['deleted']
            def delete(label, **filters):
                safe_delete(apps.get_model(label)._base_manager.filter(**filters), baseline, counts)
            if kind == 'analysis':
                delete('analysis.MatchAnalysis', pk__in=scope['analysisIds'])
            elif kind == 'game':
                delete('game.Task', pk__in=scope['taskIds'])
                delete('game.RedeemedTicket', issuer=scope['issuer'], jti__in=scope['ticketIds'])
                delete('game.Match', pk__in=scope['matchIds'])
                delete('game.GameRoom', pk__in=scope['roomIds'])
                from django.contrib.auth import get_user_model
                safe_delete(get_user_model().objects.filter(pk__in=scope['userIds']), baseline, counts)
            else:
                delete('sessions.Session', pk__in=scope['sessionIds'])
                delete('gamelink.SeenNonce', nonce__in=scope['nonces'])
                delete('tournaments.RatingResult', fixture_id__in=scope['fixtureIds'])
                delete('tournaments.WalletTransaction', user_id__in=scope['userIds'])
                delete('tournaments.Tournament', pk=scope['tournamentId'])
                delete('tournaments.Participant', pk__in=scope['participantIds'])
                from django.contrib.auth import get_user_model
                safe_delete(get_user_model().objects.filter(pk__in=scope['userIds']), baseline, counts)
                safe_delete(get_user_model().objects.filter(pk=scope['adminId']), baseline, counts)
            report['passed'] = True
    except Exception as exc:
        report.update(errorType=type(exc).__name__, deleted={})
        if isinstance(exc, ValueError):
            report['reason'] = str(exc)
        save(report_file, report)
        raise
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    save(report_file, report)


class LoadCallbackReceiptMiddleware:
    """Record only scoped nonce IDs before the callback can persist them."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == 'POST' and request.path in ('/api/gamelink/result/', '/api/gamelink/live/'):
            directory = Path('/data/e2e-audit')
            plan_file = directory / 'load-plan.json'
            if plan_file.exists():
                session = read(Path('/opt/e2e/session.json'))
                plan = validate_plan(read(plan_file), session['identity'])
                try:
                    body = json.loads(request.body)
                except (ValueError, UnicodeError):
                    body = {}
                retired_file = directory / 'load-retired-runs.json'
                if isinstance(body, dict) and retired_file.exists() and any(
                        body.get('tournament_id') == row['tournamentId']
                        and body.get('fixture_id') in row['fixtureIds'] for row in read(retired_file)):
                    from django.http import JsonResponse
                    return JsonResponse({'detail': 'Test run has ended'}, status=410)
                nonce = request.headers.get('X-Gamelink-Nonce', '')
                from tournaments.models import Fixture
                if (isinstance(body, dict) and type(body.get('tournament_id')) is int
                        and type(body.get('fixture_id')) is int and re.fullmatch(r'[a-f0-9]{32}', nonce)
                        and Fixture.objects.filter(pk=body['fixture_id'], mode__tournament_id=body['tournament_id'],
                            mode__tournament__name=plan['tournamentName'],
                            mode__tournament__creator__username=session['admin']['username']).exists()):
                    file = directory / ('load-' + plan['runId'] + '-nonces.ndjson')
                    require(not file.is_symlink(), 'Unsafe nonce receipt')
                    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                    try:
                        os.write(descriptor, (json.dumps({'nonce': nonce}) + '\n').encode())
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
        response = self.get_response(request)
        if (request.method == 'POST' and re.fullmatch(r'/api/gamelink/tournament/\d+/play/', request.path)
                and response.status_code == 200):
            directory = Path('/data/e2e-audit')
            plan_file = directory / 'load-plan.json'
            if plan_file.exists():
                session = read(Path('/opt/e2e/session.json'))
                plan = validate_plan(read(plan_file), session['identity'])
                from gamelink.models import IssuedTicket
                tickets = IssuedTicket.objects.filter(game_link__fixture__mode__tournament__name=plan['tournamentName'],
                    game_link__fixture__mode__tournament__creator__username=session['admin']['username'])
                file = directory / ('load-' + plan['runId'] + '-tickets.ndjson')
                require(not file.is_symlink(), 'Unsafe ticket receipt')
                descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                try:
                    for jti in tickets.values_list('jti', flat=True):
                        os.write(descriptor, (json.dumps({'jti': str(jti)}) + '\n').encode())
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        return response


def guard_retired_ticket(ticket):
    """Retained run receipts stop an open browser recreating deleted test data."""
    file = Path('/data/e2e-audit/load-retired-identities.json')
    if file.exists():
        retired = read(file)
        if (ticket['iss'], ticket['sub']) in {(row['issuer'], row['externalId']) for row in retired}:
            from game.link.signing import TicketError
            raise TicketError('test run has ended')


if __name__ == '__main__':
    kind, action = sys.argv[1:]
    require(kind in ('game', 'tournaments', 'analysis'), 'Unknown load service')
    sys.path.insert(0, os.getcwd())
    import django
    django.setup()
    operation(kind, action, read(Path('/opt/e2e/session.json')), Path('/data/e2e-audit'))
