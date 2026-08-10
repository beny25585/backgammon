"""Backfill Match records that predate player linking / metadata collection.

Older matches were saved with NULL white_player/black_player (so they never
appeared in any player's history) and without the metadata fields added in
migration 0007. This command repairs them from their room's RoomPlayer rows and
the room's GameEvent log.

Usage: python manage.py backfill_matches
"""

import logging

from django.core.management.base import BaseCommand

from ...game_service import _match_metadata, _room_players
from ...models import GameState, Match

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Backfill player links and metadata on existing Match rows"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without saving",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run")
        needs_players = Match.objects.filter(
            white_player__isnull=True, black_player__isnull=True
        )
        needs_metadata = Match.objects.filter(
            end_reason__isnull=True, first_player__isnull=True
        )
        match_ids = (needs_players | needs_metadata).values_list('id', flat=True)
        fixed = 0
        for match in Match.objects.filter(id__in=list(match_ids)):
            room = match.room
            if not room:
                continue
            white_player, black_player = _room_players(room)
            if match.white_player is None:
                match.white_player = white_player
            if match.black_player is None:
                match.black_player = black_player
            gs = GameState.objects.filter(room=room).first()
            state = (gs.state_data if gs else room.state) or {}
            end_reason = match.end_reason or state.get('gameEndReason')
            metadata, _transcript = _match_metadata(room, state, end_reason)
            for key, value in metadata.items():
                if value is not None and getattr(match, key) in (None, 0):
                    setattr(match, key, value)
            if dry_run:
                logger.info(
                    "Would fix %s -> %s vs %s (end=%s)",
                    match.id, match.white_player, match.black_player, match.end_reason,
                )
            else:
                match.save()
            fixed += 1
        self.stdout.write(self.style.SUCCESS(f"{fixed} matches backfilled" + (" (dry-run)" if dry_run else "")))
