from django.core.management.base import BaseCommand
from django.utils import timezone
from importlib import import_module
import traceback

from ...models import Task


def _resolve_callable(path: str):
    """Resolve a dotted path to a callable."""
    module_path, _, func_name = path.rpartition(".")
    if not module_path:
        raise ImportError(f"Invalid callable path: {path}")
    module = import_module(module_path)
    return getattr(module, func_name)


class Command(BaseCommand):
    help = "Run pending Tasks from the DB (intended to be invoked by cron or a worker)"

    def handle(self, *args, **options):
        now = timezone.now()
        qs = Task.objects.filter(status="pending").filter(run_at__lte=now)[:50]
        for task in qs:
            task.status = "running"
            task.attempts += 1
            task.last_error = None
            task.save()

            try:
                fn = _resolve_callable(task.name)
                result = fn(*task.args, **task.kwargs)
                task.result = result if result is not None else {}
                task.status = "done"
                task.save()
                self.stdout.write(self.style.SUCCESS(f"Task {task.id} done"))
            except Exception as exc:
                tb = traceback.format_exc()
                task.last_error = tb
                if task.attempts >= task.max_attempts:
                    task.status = "failed"
                else:
                    # re-schedule a retry (simple backoff: attempts * 5 minutes)
                    from datetime import timedelta

                    task.run_at = timezone.now() + timedelta(minutes=task.attempts * 5)
                    task.status = "pending"
                task.save()
                self.stdout.write(self.style.ERROR(f"Task {task.id} failed: {exc}"))