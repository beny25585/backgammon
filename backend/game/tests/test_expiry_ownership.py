"""A game cleanup worker must not override the tournaments entry policy."""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from game.entry_lifecycle import expire_unstarted_room, expire_unstarted_rooms
from game.link.models import TournamentLink
from game.models import GameRoom, Player, RoomPlayer, Task
from game.tasks import _expire_waiting_room, expire_waiting_rooms


class TournamentExpiryOwnershipTests(TestCase):
    def test_worker_budget_preserves_started_rooms_and_visits_later_unstarted_rooms(self):
        old = timezone.now() - timedelta(hours=2)
        started = GameRoom.objects.create(code='STARTD', status='playing',
            state={'presence': {'everBothConnected': True}})
        future = GameRoom.objects.create(code='FUTURE', status='waiting',
            state={'entryDeadline': (timezone.now() + timedelta(hours=1)).timestamp()})
        rooms = [GameRoom.objects.create(code=f'BND{i:03}', status='waiting') for i in range(3)]
        GameRoom.objects.filter(pk__in=[started.pk, future.pk, *[r.pk for r in rooms]]).update(created_at=old)
        self.assertEqual(expire_unstarted_rooms(limit=2), 2)
        self.assertEqual(expire_unstarted_rooms(limit=2), 1)
        self.assertEqual(expire_unstarted_rooms(limit=2), 0)
        started.refresh_from_db()
        future.refresh_from_db()
        self.assertEqual(started.status, 'playing')
        self.assertEqual(future.status, 'waiting')

    def room(self, *, status='waiting', seat_count=0):
        room = GameRoom.objects.create(code='OWN001', status=status)
        link = TournamentLink.objects.create(
            room=room, issuer='tournaments', tournament_id=32, fixture_id=72,
        )
        for index, color in enumerate(('white', 'black')[:seat_count]):
            player = Player.objects.create(user=User.objects.create(username=f'owner-{index}'))
            RoomPlayer.objects.create(room=room, player=player, color=color)
        old = timezone.now() - timedelta(hours=2)
        GameRoom.objects.filter(pk=room.pk).update(created_at=old, updated_at=old)
        return room, link

    def assert_preserved(self, room, link, status):
        room.refresh_from_db()
        link.refresh_from_db()
        self.assertEqual(room.status, status)
        self.assertEqual(link.result_status, 'pending')
        self.assertIsNone(link.result_body)
        self.assertFalse(Task.objects.exists())

    def test_legacy_cleanup_does_not_forfeit_the_only_arrived_player(self):
        room, link = self.room(seat_count=1)
        self.assertEqual(expire_waiting_rooms(), 0)
        self.assert_preserved(room, link, 'waiting')

    def test_legacy_cleanup_does_not_cancel_a_full_waiting_tournament_room(self):
        room, link = self.room(seat_count=2)
        self.assertEqual(expire_waiting_rooms(), 0)
        self.assert_preserved(room, link, 'waiting')

    def test_legacy_cleanup_rechecks_tournament_ownership_under_lock(self):
        room, link = self.room(seat_count=1)
        # Covers a candidate selected before its tournament link was visible.
        self.assertFalse(_expire_waiting_room(room.pk, timezone.now() - timedelta(hours=1)))
        self.assert_preserved(room, link, 'waiting')

    def test_main_entry_expiry_preserves_waiting_tournament_rooms(self):
        room, link = self.room(seat_count=1)
        expire_unstarted_room(room.pk)
        self.assertEqual(expire_unstarted_rooms(), 0)
        self.assert_preserved(room, link, 'waiting')

    def test_main_entry_expiry_preserves_playing_tournament_rooms(self):
        room, link = self.room(status='playing', seat_count=2)
        expire_unstarted_room(room.pk)
        self.assertEqual(expire_unstarted_rooms(), 0)
        self.assert_preserved(room, link, 'playing')

    def test_unlinked_room_is_expired_once_without_result(self):
        room = GameRoom.objects.create(code='PLAIN1', status='waiting')
        GameRoom.objects.filter(pk=room.pk).update(updated_at=timezone.now() - timedelta(hours=2))
        self.assertEqual(expire_waiting_rooms(), 1)
        self.assertEqual(expire_waiting_rooms(), 0)
        room.refresh_from_db()
        self.assertEqual(room.status, 'cancelled')
        self.assertFalse(Task.objects.exists())

    def test_legacy_candidate_that_became_active_is_not_cancelled(self):
        room = GameRoom.objects.create(code='RECENT', status='waiting')
        self.assertFalse(_expire_waiting_room(room.pk, timezone.now() - timedelta(hours=1)))
        room.refresh_from_db()
        self.assertEqual(room.status, 'waiting')
