from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase

from game.event_history import persist_game_action
from game.game_service import finalize_room
from game.models import GameEvent, GameRoom, GameState


class EventHistoryTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='HIST01', status='playing', last_sequence=9)
        self.state = GameState.objects.create(room=self.room, state_data={'version': 9, 'gameId': 'g1'})

    def test_state_only_versions_do_not_create_gaps_in_history(self):
        state = {'gameId': 'g1', 'phase': 'moving'}
        self.assertEqual(persist_game_action(self.room.pk, state, None, 'move'), 10)
        event = GameEvent.objects.get(room=self.room)
        self.assertEqual(event.sequence, 10)
        self.assertEqual(event.history_sequence, 1)
        self.assertEqual(event.payload['version'], 10)
        self.state.refresh_from_db()
        self.assertEqual(self.state.state_data['version'], 10)

    def test_failed_event_write_rolls_back_state_and_both_counters(self):
        proposed = {'gameId': 'g1', 'version': 9, 'phase': 'moving'}
        with patch('game.event_history.GameEvent.objects.create', side_effect=RuntimeError('write failed')):
            with self.assertRaises(RuntimeError):
                persist_game_action(self.room.pk, proposed, None, 'move')
        self.room.refresh_from_db()
        self.state.refresh_from_db()
        self.assertEqual(self.room.last_sequence, 9)
        self.assertEqual(self.room.history_sequence, 0)
        self.assertEqual(self.state.state_data, {'version': 9, 'gameId': 'g1'})
        self.assertEqual(proposed['version'], 9)
        self.assertFalse(GameEvent.objects.exists())

    def test_no_state_does_not_leave_an_advanced_counter_or_event(self):
        self.state.delete()
        with self.assertRaises(GameState.DoesNotExist):
            persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'move')
        self.room.refresh_from_db()
        self.assertEqual(self.room.last_sequence, 9)
        self.assertEqual(self.room.history_sequence, 0)
        self.assertFalse(GameEvent.objects.exists())

    def test_room_lock_and_state_history_use_four_data_queries_for_system_action(self):
        # The nested savepoint is separate from SELECT/UPDATE/INSERT statements.
        with self.assertNumQueries(6):
            persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'opening_result_done')

    def test_new_history_ordinals_are_unique_in_the_database(self):
        persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'move')
        with self.assertRaises(IntegrityError), transaction.atomic():
            GameEvent.objects.create(room=self.room, game_id='g1', sequence=11, history_sequence=1, event_type='move')

    def test_finalization_seals_history_without_using_the_state_version(self):
        persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'move')
        GameRoom.objects.filter(pk=self.room.pk).update(last_sequence=11)
        match = finalize_room(self.room, {'gameId': 'g1', 'cube': 1}, 'white', 'single', 'inactivity_timeout')
        self.assertEqual(match.history_sequence, 1)
        with self.assertRaises(ValueError):
            persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'move')
        self.assertEqual(GameEvent.objects.count(), 1)

    def test_legacy_rooms_keep_their_history_unverified(self):
        GameRoom.objects.filter(pk=self.room.pk).update(history_sequence=None)
        persist_game_action(self.room.pk, {'gameId': 'g1'}, None, 'move')
        self.assertIsNone(GameEvent.objects.get(room=self.room).history_sequence)
