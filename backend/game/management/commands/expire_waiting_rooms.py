from django.core.management.base import BaseCommand

from ...tasks import expire_waiting_rooms


class Command(BaseCommand):
    help = "Expire orphaned waiting rooms that have been inactive for N minutes"

    def add_arguments(self, parser):
        parser.add_argument(
            "minutes",
            type=int,
            nargs="?",
            default=30,
            help="Number of minutes of inactivity after which a waiting room is expired",
        )
        parser.add_argument(
            "--enqueue",
            action="store_true",
            help="Enqueue a Task row instead of running immediately (for production workers)",
        )

    def handle(self, *args, **options):
        minutes = options.get("minutes") or 30
        enqueue = options.get("enqueue")
        if enqueue:
            # create a Task row for background worker to pick up
            from ...models import Task
            run_at = None
            Task.objects.create(
                name="game.tasks.expire_waiting_rooms",
                args=[minutes],
                run_at=run_at,
            )
            self.stdout.write(self.style.SUCCESS("Enqueued expire_waiting_rooms task"))
            return

        count = expire_waiting_rooms(minutes=minutes)
        self.stdout.write(self.style.SUCCESS(f"Expired {count} waiting rooms"))
