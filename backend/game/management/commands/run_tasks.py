from django.core.management.base import BaseCommand
from django.utils import timezone
from game.models import Task
from game.task_runner import runnable, run_task


class Command(BaseCommand):
    help = 'Run due tasks and recover abandoned leases; results retry until acknowledged.'

    def handle(self, *args, **options):
        ids = list(Task.objects.filter(runnable(timezone.now())).order_by('run_at', 'created_at')
                   .values_list('pk', flat=True)[:50])
        for task_id in ids:
            done = run_task(task_id)
            self.stdout.write(f'Task {task_id}: {"done" if done else "deferred or failed"}')
