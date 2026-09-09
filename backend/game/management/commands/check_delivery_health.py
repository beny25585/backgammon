import json
from django.core.management.base import BaseCommand, CommandError
from game.operations import delivery_health


class Command(BaseCommand):
    help = 'Check the database and durable result queue; exits nonzero when operator attention is needed.'

    def handle(self, *args, **options):
        health = delivery_health()
        self.stdout.write(json.dumps(health))
        if health['status'] != 'ok':
            raise CommandError('Result delivery is degraded. Check run_tasks and tournament connectivity.')
