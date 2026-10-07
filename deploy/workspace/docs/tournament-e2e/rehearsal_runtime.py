"""Sanitized, read-only task evidence restricted to pinned browser databases."""
from datetime import datetime, timedelta, timezone
from contextlib import nullcontext
import json

RECURRING = ('reconcile_searches', 'expire_unstarted_games',
             'start_scheduled_tournaments', 'expire_tournament_entry_deadlines')
RUNTIME_PATH = '/api/__e2e__/background-tasks/'
PUSH_MODELS = ('frontend.pushdelivery', 'frontend.fixturepushdelivery',
               'frontend.tablepushdelivery', 'frontend.tournamentreminderdelivery')


def push_baseline(plan, baseline, identity):
    """A copied queue exemption must come from this run's complete saved inventory."""
    from load_cleanup import validate_plan
    validate_plan(plan, identity)
    if baseline.get('runId') != plan['runId'] or baseline.get('targetSession') != identity['session_id']:
        raise ValueError('Push baseline belongs to another run or session')
    models = baseline.get('models', {})
    if any(not isinstance(models.get(label), list)
           or any(not isinstance(pk, str) or not pk.isdecimal() for pk in models[label])
           for label in PUSH_MODELS):
        raise ValueError('Push baseline inventory is incomplete')
    return {label: set(models[label]) for label in PUSH_MODELS}


def push_queue_counts(rows, previous_ids, now):
    """Use the staff health endpoint's queue thresholds, preserving old/new counts."""
    result = {scope: dict(failed=0, retrying=0, delayed=0) for scope in ('inherited', 'new')}
    for pk, attempts, next_attempt in rows:
        counts = result['inherited' if str(pk) in previous_ids else 'new']
        if next_attempt <= now:
            if attempts >= 5:
                counts['failed'] += 1
            elif attempts > 0:
                counts['retrying'] += 1
        if attempts < 5 and next_attempt < now - timedelta(minutes=2):
            counts['delayed'] += 1
    return result


def copied_push_snapshot(identity, now):
    from pathlib import Path
    from django.apps import apps
    from load_cleanup import read
    directory = Path('/data/e2e-audit')
    plan_file = directory / 'load-plan.json'
    # Preparation checks the service role before a browser run has a baseline.
    if not plan_file.exists():
        return None
    plan = read(plan_file)
    from load_cleanup import validate_plan
    validate_plan(plan, identity)
    baseline = read(directory / ('load-' + plan['runId'] + '-tournaments-baseline.json'))
    previous = push_baseline(plan, baseline, identity)
    counts = {scope: dict(failed=0, retrying=0, delayed=0) for scope in ('inherited', 'new')}
    for label in PUSH_MODELS:
        rows = apps.get_model(label).objects.filter(
            delivered_at=None, discarded_at=None, next_attempt_at__lte=now
        ).values_list('pk', 'attempts', 'next_attempt_at').iterator(chunk_size=1000)
        model_counts = push_queue_counts(rows, previous[label], now)
        for scope in counts:
            for code in counts[scope]:
                counts[scope][code] += model_counts[scope][code]
    return {'run_id': plan['runId'], 'target_session': identity['session_id'],
            **{scope + '_issues': [{'code': code, 'count': count} for code, count in values.items() if count]
               for scope, values in counts.items()}}


def snapshot(kind):
    from django.conf import settings
    from django.db import connection, transaction
    from rehearsal_entry import session, validate_settings
    import os

    identity = session()
    validate_settings(identity, kind, settings.DATABASES['default'], os.environ.get('REDIS_URL'))
    if settings.DEBUG:
        raise ValueError('Runtime evidence requires production-mode rehearsal settings')
    result = {'schema_version': 1, 'session_id': identity['session_id'], 'kind': kind,
              'observed_at': datetime.now(timezone.utc).isoformat()}
    already_atomic = connection.in_atomic_block
    with nullcontext() if already_atomic else transaction.atomic():
        with connection.cursor() as cursor:
            if already_atomic:
                cursor.execute('SHOW transaction_read_only')
                if cursor.fetchone()[0] != 'on':
                    raise ValueError('Runtime evidence requires a read-only transaction')
            else:
                cursor.execute('SET TRANSACTION READ ONLY')
        if kind == 'game':
            from game.models import Task
            rows = Task.objects.filter(key='inactivity-watchdog').values(
                'name', 'status', 'updated_at', 'run_at', 'last_error')
        else:
            from frontend.models import Task, PushWorkerStatus
            rows = Task.objects.filter(name__in=RECURRING).values(
                'name', 'status', 'updated_at', 'run_at', 'last_finished_at', 'last_error')
            push = PushWorkerStatus.objects.filter(pk=1).values('last_seen_at', 'expected_by').first()
            result['push'] = push
            if identity.get('load_cleanup_version') == 1:
                result['copied_push_health'] = copied_push_snapshot(identity, datetime.now(timezone.utc))
            result['admin_commands'] = {
                'error_tasks': Task.objects.filter(name='deliver_admin_command').exclude(last_error='').count(),
                'completed_tasks': Task.objects.filter(name='deliver_admin_command', status='done').count(),
            }
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM gamelink_admingamecommand c "
                    "WHERE c.status = 'pending' AND NOT EXISTS (SELECT 1 FROM frontend_task t "
                    "WHERE t.key = 'admin-command:' || c.id::text)")
                result['admin_commands']['pending_without_task'] = cursor.fetchone()[0]
        result['tasks'] = [{**{key: value for key, value in row.items() if key != 'last_error'},
                            'has_error': bool(row['last_error'])} for row in rows]
    return json.loads(json.dumps(result, default=lambda value: value.isoformat()))


def progress(before, after, push_required=False):
    """A queued recurring task is healthy when its successful cycles advance."""
    if before.get('session_id') != after.get('session_id') or before.get('kind') != after.get('kind'):
        raise ValueError('Runtime snapshots belong to different services or sessions')
    issues, checks = [], {}
    prior = {row['name']: row for row in before['tasks']}
    current = {row['name']: row for row in after['tasks']}
    names = RECURRING if after['kind'] == 'tournaments' else ('game.inactivity.check_inactivity_watchdog',)
    for name in names:
        first, last = prior.get(name), current.get(name)
        unique = all(sum(row['name'] == name for row in sample['tasks']) == 1 for sample in (before, after))
        field = 'last_finished_at' if after['kind'] == 'tournaments' else 'run_at'
        advanced = bool(first and last and first.get(field) and last.get(field)
                        and datetime.fromisoformat(last[field]) > datetime.fromisoformat(first[field]))
        clean = bool(unique and last and not last.get('has_error') and last['status'] in ('pending', 'running', 'done'))
        checks[name] = {'successful_cycle_advanced': advanced, 'no_error': clean,
                        'status': last.get('status') if last else 'missing'}
        if not advanced or not clean:
            issues.append(name + (': no successful progress observed' if clean else ': missing or task error'))
    if after['kind'] == 'tournaments':
        scoped = after.get('copied_push_health')
        if 'copied_push_health' in before or 'copied_push_health' in after:
            first = before.get('copied_push_health')
            if not first or not scoped or first['run_id'] != scoped['run_id'] or scoped['target_session'] != after['session_id']:
                raise ValueError('Push snapshots belong to different runs')
            checks['copied_push_queue'] = scoped
            if scoped['new_issues']:
                issues.append('push: deliveries created after the run baseline are unhealthy')
        admin = after['admin_commands']
        checks['admin_commands'] = {**admin, 'business_command_triggered': admin['completed_tasks'] > 0}
        if admin['error_tasks'] or admin['pending_without_task']:
            issues.append('admin_commands: failed or not queued')
        if push_required:
            first, last = before.get('push'), after.get('push')
            healthy = bool(first and last and first.get('last_seen_at') and last.get('last_seen_at') and last.get('expected_by') and
                datetime.fromisoformat(last['last_seen_at']) > datetime.fromisoformat(first['last_seen_at']) and
                datetime.fromisoformat(last['expected_by']) > datetime.fromisoformat(after['observed_at']))
            checks['push'] = {'heartbeat_advanced_and_current': healthy, 'device_delivery_tested': False}
            if not healthy:
                issues.append('push: no current advancing heartbeat')
    return {'passed': not issues, 'checks': checks, 'issues': issues}


async def serve(scope, send):
    """Only the opt-in test ASGI wrapper exposes these fixed, non-secret fields."""
    from channels.db import database_sync_to_async
    import os
    from rehearsal_entry import session

    identity = session()
    headers = dict(scope.get('headers', []))
    if scope.get('method') != 'GET' or headers.get(b'x-e2e-session', b'').decode('ascii', errors='ignore') != identity['session_id']:
        status, value = 403, {'detail': 'Explicit rehearsal session required'}
    else:
        try:
            value = await database_sync_to_async(snapshot)(os.environ['E2E_ADMISSION_KIND'])
            status = 200
        except Exception:
            status, value = 503, {'detail': 'Fresh rehearsal task evidence unavailable'}
    await send({'type': 'http.response.start', 'status': status, 'headers': [
        (b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
    await send({'type': 'http.response.body', 'body': json.dumps(value).encode()})
