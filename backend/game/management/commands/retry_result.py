from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from game.models import Task
from game.task_runner import RESULT_TASK


class Command(BaseCommand):
    help = 'Requeue a blocked result after resolving its reported conflict. Preserves the result body and attempt history.'

    def add_arguments(self, parser):
        parser.add_argument('task_id', type=str)

    def handle(self, *args, **options):
        import uuid
        try:
            task_id = uuid.UUID(options['task_id'])
        except ValueError as exc:
            raise CommandError('Enter a valid task UUID.') from exc
        updated = Task.objects.filter(pk=task_id, name=RESULT_TASK, status='blocked').update(
            status='pending', run_at=timezone.now(), updated_at=timezone.now(),
        )
        if not updated:
            raise CommandError('No blocked result delivery found for this task. Nothing changed.')
        self.stdout.write(self.style.SUCCESS(f'Task {task_id} queued for run_tasks.'))
