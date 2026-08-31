from django.core.management.base import BaseCommand

from ...link.housekeeping import purge_redeemed_tickets


class Command(BaseCommand):
    help = "Delete spent tournament link tickets that are past their expiry"

    def handle(self, *args, **options):
        count = purge_redeemed_tickets()
        self.stdout.write(self.style.SUCCESS(f"Purged {count} redeemed tickets"))
