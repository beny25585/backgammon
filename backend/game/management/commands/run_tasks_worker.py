import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.utils import timezone

from game.entry_lifecycle import expire_unstarted_rooms
from game.models import Task
from game.task_runner import runnable, run_task


class Command(BaseCommand):
    help = "Continuously execute due game tasks."

    def add_arguments(self, parser):
        parser.add_argument(
            "--interval",
            type=float,
            default=5.0,
            help="Seconds between queue checks.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=50,
            help="Maximum tasks per batch.",
        )

    def handle(self, *args, **options):
        interval = options["interval"]
        limit = options["limit"]

        if interval <= 0:
            raise CommandError("--interval must be positive.")

        if limit < 1:
            raise CommandError("--limit must be positive.")

        from game.inactivity import ensure_inactivity_watchdog
        ensure_inactivity_watchdog()

        self.stdout.write(
            self.style.SUCCESS(
                f"Game task worker started: interval={interval}s limit={limit}"
            )
        )

        while True:
            close_old_connections()

            expire_unstarted_rooms()

            ids = list(
                Task.objects
                .filter(runnable(timezone.now()))
                .order_by("run_at", "created_at")
                .values_list("pk", flat=True)[:limit]
            )

            for task_id in ids:
                try:
                    done = run_task(task_id)
                except Exception as exc:
                    self.stderr.write(
                        f"Task {task_id} crashed: {exc}"
                    )
                else:
                    if done:
                        self.stdout.write(
                            f"Task {task_id}: done"
                        )

            time.sleep(interval)
