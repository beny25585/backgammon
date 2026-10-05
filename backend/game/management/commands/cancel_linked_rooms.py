from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from ...link.models import TournamentLink
from ...link.locking import lock_linked_room


class Command(BaseCommand):
    help = (
        "Cancel and detach incorrectly provisioned tournament rooms so corrected tickets can "
        "create one fresh room"
    )

    def add_arguments(self, parser):
        scope = parser.add_mutually_exclusive_group(required=True)
        scope.add_argument("--tournament-id", type=int)
        scope.add_argument(
            "--room-code",
            action="append",
            dest="room_codes",
            help="Cancel this exact room code; repeat for multiple split rooms",
        )
        parser.add_argument(
            "--fixture-id",
            type=int,
            action="append",
            dest="fixture_ids",
            help="Limit cleanup to this fixture id; repeat for multiple erroneous fixtures",
        )
        parser.add_argument(
            "--issuer",
            default="tournaments",
            help="Ticket issuer (default: tournaments)",
        )
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Apply the cleanup. Without this flag the command is a dry run.",
        )

    def handle(self, *args, **options):
        links = TournamentLink.objects.select_related("room").filter(
            issuer=options["issuer"],
            room__status__in=("waiting", "playing"),
        )
        if options.get("tournament_id") is not None:
            links = links.filter(tournament_id=options["tournament_id"])
        else:
            room_codes = [code.strip().upper() for code in options["room_codes"] if code.strip()]
            links = links.filter(room__code__in=room_codes)
        fixture_ids = options.get("fixture_ids") or []
        if fixture_ids:
            links = links.filter(fixture_id__in=fixture_ids)

        # A split-room incident has exactly one occupied seat in each room. Never let this repair
        # command tear down a real two-player game.
        links = list(links.annotate(seat_count=Count("room__players")).filter(seat_count__lte=1))
        if not links:
            raise CommandError("No one-seat active linked rooms matched the requested scope.")

        for link in links:
            self.stdout.write(
                f"tournament={link.tournament_id} fixture={link.fixture_id} room={link.room.code} "
                f"status={link.room.status} seats={link.seat_count}"
            )

        if not options["execute"]:
            self.stdout.write(self.style.WARNING(
                f"Dry run: {len(links)} room(s) would be cancelled and detached. "
                "Re-run with --execute to apply."
            ))
            return

        cleaned = 0
        for candidate in links:
            with transaction.atomic():
                room, link = lock_linked_room(candidate.room_id, pk=candidate.pk)
                if link is None:
                    continue
                if room.status not in ("waiting", "playing") or room.players.count() > 1:
                    continue
                room.status = "cancelled"
                room.save(update_fields=["status", "updated_at"])
                # Detaching is intentional: the next corrected ticket for this fixture must
                # provision a fresh room instead of resolving back to the cancelled one.
                link.delete()
                cleaned += 1

        self.stdout.write(self.style.SUCCESS(
            f"Cancelled and detached {cleaned} incorrectly provisioned room(s)."
        ))
