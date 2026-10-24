"""Explicit, dry-run-first repair for blocked oversized settlement envelopes."""
import copy
import json
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from game.link.models import TournamentLink
from game.link.outbox import TASK_NAME, _match_details
from game.link.replay import replay_reference
from game.models import Match, Task


class Command(BaseCommand):
    help = 'Inspect oversized frozen results; --apply preserves the original and requeues the same task.'

    def add_arguments(self, parser):
        parser.add_argument('--link-id', type=int, action='append', required=True,
                            help='Explicit TournamentLink primary key; repeat for more than one.')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--reason', default='')

    def handle(self, *args, **options):
        if options['apply'] and not options['reason'].strip():
            raise CommandError('--reason is required with --apply.')
        for link_id in options['link_id']:
            with transaction.atomic():
                link = TournamentLink.objects.select_for_update().filter(pk=link_id).first()
                if link is None:
                    raise CommandError(f'Link {link_id} does not exist.')
                task = Task.objects.select_for_update().filter(key=f'result:{link.pk}', name=TASK_NAME).first()
                body = link.result_body
                size = len(json.dumps(body, sort_keys=True, separators=(',', ':')).encode())
                if (link.result_status != 'queued' or task is None or task.status != 'blocked'
                        or task.kwargs != {'link_id': link.pk} or task.args
                        or not isinstance(body, dict) or body.get('replay')
                        or size <= 64 * 1024 or task.delivery_payload is not None):
                    raise CommandError(f'Link {link_id} is not an untouched blocked oversized result.')
                if '413' not in (task.last_error or ''):
                    raise CommandError(f'Link {link_id} was not blocked for HTTP 413.')
                try:
                    match_id = str(uuid.UUID(body['match_id']))
                except (KeyError, ValueError, TypeError, AttributeError):
                    raise CommandError(f'Link {link_id} has an invalid stored match identifier.') from None
                match = Match.objects.filter(pk=match_id, room_id=link.room_id).first()
                if (match is None or body.get('room_id') != str(link.room_id)
                        or body.get('fixture_id') != link.fixture_id
                        or body.get('tournament_id') != link.tournament_id
                        or body.get('match_details') != _match_details(match)):
                    raise CommandError(f'Link {link_id} audit data does not match its stored match.')
                compact = copy.deepcopy(body)
                compact['match_details'].pop('games')
                compact['replay'] = replay_reference(match)
                new_size = len(json.dumps(compact, sort_keys=True, separators=(',', ':')).encode())
                if new_size > 64 * 1024:
                    raise CommandError(f'Link {link_id} remains oversized after separating its transcript.')
                self.stdout.write(f'{"APPLY" if options["apply"] else "DRY RUN"} link={link.pk} '
                                  f'task={task.pk} bytes={size}->{new_size}')
                if options['apply']:
                    # Retain the exact original alongside the existing task identity, not in the wire body.
                    task.delivery_payload = {'original_result_body': body, 'compacted_at': timezone.now().isoformat(),
                                             'reason': options['reason'].strip()}
                    task.status = 'pending'
                    task.run_at = timezone.now()
                    task.lease_token = None
                    task.last_error = ''
                    task.save(update_fields=['delivery_payload', 'status', 'run_at', 'lease_token',
                                             'last_error', 'updated_at'])
                    link.result_body = compact
                    link.save(update_fields=['result_body'])
