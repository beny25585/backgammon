from datetime import timedelta
from django.db import connection
from django.utils import timezone
from game.link.models import TournamentLink
from game.models import Task
from game.task_runner import RESULT_TASK, LEASE_SECONDS


def delivery_health():
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
        cursor.fetchone()
    now = timezone.now()
    queued = TournamentLink.objects.filter(result_status='queued')
    tasks = Task.objects.filter(name=RESULT_TASK).exclude(status='done')
    overdue = tasks.filter(created_at__lt=now - timedelta(minutes=5)).count()
    stranded = tasks.filter(status='running', updated_at__lt=now - timedelta(seconds=LEASE_SECONDS)).count()
    failed = tasks.filter(status='failed').count()
    # A queued link without a task cannot make progress even if the worker is running.
    tracked = {str(item['link_id']) for item in tasks.values_list('kwargs', flat=True) if 'link_id' in item}
    missing = sum(str(pk) not in tracked for pk in queued.values_list('pk', flat=True))
    return {'status': 'degraded' if overdue or stranded or failed or missing else 'ok',
            'queued_results': queued.count(), 'overdue_deliveries': overdue,
            'abandoned_leases': stranded, 'failed_deliveries': failed, 'missing_tasks': missing}
