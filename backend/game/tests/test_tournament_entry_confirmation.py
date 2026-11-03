"""The ticket handoff cannot start a tournament with a departed waiting client."""
from django.contrib.auth.models import User
from django.test import TestCase

from game.engine import BackgammonEngine
from game.link.models import TournamentLink
from game.link.tests import link_settings
from game.models import GameRoom, GameState, Player, RoomPlayer, Task
from game.presence import (
    cancel_tournament_entry, confirm_tournament_entry, mark_connected, mark_disconnected,
)


@link_settings
class TournamentEntryConfirmationTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='ENTRY1', status='waiting')
        GameState.objects.create(room=self.room, state_data=BackgammonEngine.get_initial_state())
        self.link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=482, room=self.room,
        )
        for color in ('white', 'black'):
            player = Player.objects.create(user=User.objects.create_user(f'entry-{color}'))
            RoomPlayer.objects.create(room=self.room, player=player, color=color)

    def connect(self, channel, color, now):
        mark_connected(self.room.pk, channel, color, now=now)
        self.room.refresh_from_db()
        return self.room.state['presence']['entryChallenge']

    def test_two_sockets_and_one_acknowledgement_do_not_start(self):
        self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=102))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'waiting')
        self.assertFalse(self.room.state['presence'].get('everBothConnected', False))
        self.assertFalse(Task.objects.filter(name='game.link.live.deliver_status_event').exists())

    def test_both_current_acknowledgements_start_and_publish_exactly_once(self):
        self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=102))
        self.assertTrue(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=103))
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=104))
        self.room.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertTrue(self.room.state['presence']['everBothConnected'])
        self.assertIsNotNone(self.link.status_started_at)
        task = Task.objects.get(name='game.link.live.deliver_status_event')
        self.assertEqual(task.kwargs['body']['event_type'], 'started')
        self.assertEqual(task.kwargs['body']['status'], 'playing')

    def test_departed_player_acknowledgement_cannot_admit_the_opponent(self):
        self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=102)
        mark_disconnected(self.room.pk, 'white-1', now=103)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=104))
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=104))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'waiting')
        self.assertFalse(self.room.state['presence'].get('needsAdminAdjudication', False))

    def test_hidden_client_clears_only_its_own_ready_acknowledgement(self):
        self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=102)
        cancel_tournament_entry(self.room.pk, 'white-1')
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=103))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'waiting')

    def test_new_socket_invalidates_old_verification_round(self):
        previous = self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        self.assertNotEqual(previous, challenge)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'white-1', previous, now=102))
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=102))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'waiting')

    def test_expired_round_requires_new_acknowledgements_from_both_players(self):
        self.connect('white-1', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        confirm_tournament_entry(self.room.pk, 'white-1', challenge, now=102)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=107))
        self.room.refresh_from_db()
        fresh = self.room.state['presence']['entryChallenge']
        self.assertNotEqual(challenge, fresh)
        self.assertFalse(confirm_tournament_entry(self.room.pk, 'black-1', fresh, now=108))
        self.assertTrue(confirm_tournament_entry(self.room.pk, 'white-1', fresh, now=109))

    def test_old_tab_disconnect_does_not_remove_other_tab_confirmation(self):
        self.connect('white-old', 'white', 100)
        self.connect('white-current', 'white', 100)
        challenge = self.connect('black-1', 'black', 101)
        confirm_tournament_entry(self.room.pk, 'white-current', challenge, now=102)
        mark_disconnected(self.room.pk, 'white-old', now=102)
        self.assertTrue(confirm_tournament_entry(self.room.pk, 'black-1', challenge, now=103))
