"""Scoring and history survive resignation, full-series leave and retries."""
from unittest.mock import patch

from django.test import TestCase

from game.engine import BackgammonEngine
from game.game_service import finalize_room, game_ended_payload, record_game_end
from game.models import GameRoom, GameState, Match


class SeriesEndingTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='END001', status='playing', target_points=7)
        self.state = BackgammonEngine.get_initial_state()
        self.state.update(gameFormat='match', gameId='first', cube=1, phase='moving')
        GameState.objects.create(room=self.room, state_data=self.state)

    def test_force_close_preserves_preceding_games_and_awards_current_game_once(self):
        first = record_game_end(self.room, self.state, 'white', 'gammon', 'give_up')
        self.assertFalse(first['match_over'])
        next_state = {**self.state, 'gameId': 'second'}
        GameState.objects.filter(room=self.room).update(state_data=next_state)
        match = finalize_room(self.room, next_state, 'black', 'single', 'leave')
        self.assertEqual((match.white_score, match.black_score), (2, 1))
        self.assertEqual([game['game_id'] for game in match.games], ['first', 'second'])
        self.assertEqual([game['winner'] for game in match.games], ['white', 'black'])
        self.assertIsNone(finalize_room(self.room, next_state, 'white', 'backgammon', 'disconnect'))
        self.assertIsNone(record_game_end(self.room, next_state, 'white', 'backgammon', 'give_up'))
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)

    def test_leave_between_games_closes_series_without_rescoring_last_game(self):
        record_game_end(self.room, self.state, 'white', 'gammon', 'give_up')
        saved = GameState.objects.get(room=self.room).state_data
        with patch('game.game_service._report_to_tournament') as report:
            match = finalize_room(self.room, saved, 'black', 'single', 'leave')
            self.assertEqual((match.white_score, match.black_score), (2, 0))
            self.assertEqual(match.winner, 'black')
            self.assertEqual(match.end_reason, 'leave')
            self.assertEqual(len(match.games), 1)
            self.assertEqual(match.games[0]['winner'], 'white')
            self.assertEqual(match.games[0]['points_awarded'], 2)
            self.assertIsNone(finalize_room(self.room, saved, 'black', 'single', 'leave'))
            report.assert_called_once()
        self.room.refresh_from_db()
        stored = GameState.objects.get(room=self.room).state_data
        self.assertEqual(self.room.status, 'completed')
        self.assertEqual(stored['gameEndReason'], 'leave')
        self.assertEqual(stored['gameEndPoints'], 0)
        self.assertEqual(game_ended_payload(stored, 'black', 'single', 'leave', self.room)['points'], 0)

    def test_leave_uses_new_board_if_auto_next_game_already_started(self):
        record_game_end(self.room, self.state, 'white', 'single', 'give_up')
        old = GameState.objects.get(room=self.room).state_data
        current = {**self.state, 'gameId': 'second'}
        GameState.objects.filter(room=self.room).update(state_data=current)
        match = finalize_room(self.room, old, 'black', 'single', 'leave')
        self.assertEqual((match.white_score, match.black_score), (1, 1))
        self.assertEqual([game['game_id'] for game in match.games], ['first', 'second'])
        self.assertEqual(GameState.objects.get(room=self.room).state_data['gameId'], 'second')

    def test_delayed_non_leave_result_cannot_close_already_scored_game(self):
        record_game_end(self.room, self.state, 'white', 'single', 'give_up')
        self.assertIsNone(finalize_room(self.room, self.state, 'black', 'backgammon', 'disconnect'))
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual((self.room.white_score, self.room.black_score), (1, 0))
        self.assertFalse(Match.objects.exists())

    def test_legacy_duplicate_remains_noop(self):
        self.state.pop('gameFormat')
        record_game_end(self.room, self.state, 'white', 'single', 'give_up')
        self.assertIsNone(finalize_room(self.room, self.state, 'black', 'single', 'leave'))

    def test_failed_reporting_rolls_back_close_and_can_retry(self):
        record_game_end(self.room, self.state, 'white', 'gammon', 'give_up')
        saved = GameState.objects.get(room=self.room).state_data
        with patch('game.game_service._report_to_tournament', side_effect=RuntimeError('outbox failure')):
            with self.assertRaises(RuntimeError):
                finalize_room(self.room, saved, 'black', 'single', 'leave')
        self.room.refresh_from_db()
        self.assertEqual(self.room.status, 'playing')
        self.assertEqual((self.room.white_score, self.room.black_score), (2, 0))
        self.assertFalse(Match.objects.exists())
        self.assertIsNotNone(finalize_room(self.room, saved, 'black', 'single', 'leave'))
