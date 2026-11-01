"""A series forfeit advances the tournament without inventing played points."""
from copy import deepcopy
import json
from unittest.mock import patch

import httpx
from django.test import TestCase, override_settings

from game.engine import BackgammonEngine
from game.game_service import finalize_room, record_game_end
from game.models import GameRoom, GameState, Match, Task

from .models import TournamentLink
from .outbox import build_result_body, deliver_result, enqueue_result


@override_settings(
    GAMELINK_RESULT_SECRET='technical-result-test-secret-0123456789',
    GAMELINK_TOURNAMENTS_URL='https://tournaments.example',
)
class TechnicalTournamentResultTests(TestCase):
    def setUp(self):
        self.room_number = 0
        immediate = patch('game.link.outbox.try_deliver_now')
        immediate.start()
        self.addCleanup(immediate.stop)

    def make_link(self, *, white=1, black=0, target=5, game_format='match',
                  p1_color='white', tournament=17, fixture=None):
        self.room_number += 1
        room = GameRoom.objects.create(
            code=f'T{self.room_number:05d}', status='playing', target_points=target,
            white_score=white, black_score=black,
        )
        state = BackgammonEngine.get_initial_state()
        state.update(gameFormat=game_format, phase='moving', cube=1)
        GameState.objects.create(room=room, state_data=state)
        link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=tournament,
            fixture_id=fixture if fixture is not None else 200 + self.room_number,
            room=room, seat_p1_color=p1_color,
        )
        return room, state, link

    def finish(self, room, state, link, *, winner='black', reason='time'):
        match = finalize_room(room, state, winner, 'single', reason)
        room.refresh_from_db()
        link.refresh_from_db()
        return match, link.result_body

    def test_timeout_tie_freezes_an_official_win_and_preserves_played_score(self):
        room, state, link = self.make_link()
        match, body = self.finish(room, state, link)
        self.assertEqual((room.white_score, room.black_score), (1, 1))
        self.assertEqual((match.white_score, match.black_score), (1, 1))
        self.assertEqual(match.winner, 'black')
        self.assertEqual(body['winner_seat'], 'p2')
        self.assertEqual(body['score'], {'p1': 1, 'p2': 5})
        self.assertEqual(body['technical_result'], {
            'reason': 'time', 'played_score': {'p1': 1, 'p2': 1},
        })
        self.assertEqual(body['match_details']['black_score'], 1)
        self.assertEqual(match.games[-1]['points_awarded'], 1)
        self.assertEqual(match.games[-1]['score_after'], {'white': 1, 'black': 1})
        self.assertEqual(GameState.objects.get(room=room).state_data['gameEndPoints'], 1)
        self.assertEqual(link.result_status, 'queued')
        self.assertEqual(Task.objects.filter(key=f'result:{link.pk}').count(), 1)

    def test_technical_winner_who_was_trailing_cannot_advance_the_opponent(self):
        room, state, link = self.make_link(white=0, black=4)
        match, body = self.finish(room, state, link, winner='white')
        self.assertEqual((match.white_score, match.black_score), (1, 4))
        self.assertEqual(body['score'], {'p1': 5, 'p2': 4})
        self.assertEqual(body['winner_seat'], 'p1')
        self.assertEqual(body['technical_result']['played_score'], {'p1': 1, 'p2': 4})

    def test_both_winners_map_correctly_when_player_one_is_black(self):
        for winner in ('white', 'black'):
            with self.subTest(winner=winner):
                room, state, link = self.make_link(white=0, black=0, p1_color='black')
                match, body = self.finish(room, state, link, winner=winner)
                winner_seat = 'p2' if winner == 'white' else 'p1'
                loser_seat = 'p1' if winner == 'white' else 'p2'
                self.assertEqual(body['winner_seat'], winner_seat)
                self.assertEqual(body['score'][winner_seat], 5)
                self.assertEqual(body['score'][loser_seat], 0)
                self.assertEqual(body['technical_result']['played_score'][winner_seat], 1)
                self.assertEqual(match.winner, winner)

    def test_all_supported_series_end_reasons_use_the_same_official_rule(self):
        for reason in ('time', 'leave', 'disconnect', 'inactivity_timeout'):
            with self.subTest(reason=reason):
                room, state, link = self.make_link()
                _match, body = self.finish(room, state, link, reason=reason)
                self.assertEqual(body['score'], {'p1': 1, 'p2': 5})
                self.assertEqual(body['technical_result']['reason'], reason)
                self.assertEqual(body['end_reason'], reason)

    def test_preceding_games_and_the_current_game_remain_the_played_history(self):
        room, first, link = self.make_link(white=0, black=0)
        self.assertFalse(record_game_end(room, first, 'white', 'single', 'bear_off')['match_over'])
        room.refresh_from_db()
        preceding = deepcopy(room.state['match']['games'])
        second = BackgammonEngine.get_initial_state()
        second.update(gameFormat='match', phase='moving')
        GameState.objects.filter(room=room).update(state_data=second)
        match, body = self.finish(room, second, link)
        self.assertEqual(match.games[:-1], preceding)
        self.assertEqual([game['points_awarded'] for game in match.games], [1, 1])
        self.assertEqual(match.games[-1]['score_before'], {'white': 1, 'black': 0})
        self.assertEqual(match.games[-1]['score_after'], {'white': 1, 'black': 1})
        self.assertEqual(body['score'], {'p1': 1, 'p2': 5})

    def test_leaving_between_games_adds_no_fictitious_game_or_points(self):
        room, state, link = self.make_link(white=0, black=0)
        record_game_end(room, state, 'white', 'single', 'bear_off')
        saved = GameState.objects.get(room=room).state_data
        match, body = self.finish(room, saved, link, reason='leave')
        self.assertEqual((match.white_score, match.black_score), (1, 0))
        self.assertEqual(len(match.games), 1)
        self.assertEqual(GameState.objects.get(room=room).state_data['gameEndPoints'], 0)
        self.assertEqual(body['score'], {'p1': 1, 'p2': 5})
        self.assertEqual(body['technical_result']['played_score'], {'p1': 1, 'p2': 0})

    def test_duplicate_finish_cannot_replace_or_queue_the_result_twice(self):
        room, state, link = self.make_link()
        _match, body = self.finish(room, state, link)
        frozen = deepcopy(body)
        self.assertIsNone(finalize_room(room, state, 'white', 'backgammon', 'time'))
        self.assertIsNone(enqueue_result(link, None, room, 'completed', winner_color='white',
                                         end_reason='time'))
        link.refresh_from_db()
        self.assertEqual(link.result_body, frozen)
        self.assertEqual(Match.objects.filter(room=room).count(), 1)
        self.assertEqual(Task.objects.filter(key=f'result:{link.pk}').count(), 1)

    def test_http_retry_uses_the_same_frozen_body_after_room_scores_change(self):
        room, state, link = self.make_link()
        _match, frozen = self.finish(room, state, link)
        request = httpx.Request('POST', 'https://tournaments.example/api/gamelink/result/')
        responses = [httpx.Response(503, request=request),
                     httpx.Response(200, json={'status': 'recorded'}, request=request)]
        with patch('game.link.outbox.httpx.post', side_effect=responses) as post:
            with self.assertRaisesRegex(RuntimeError, 'HTTP 503'):
                deliver_result(link.pk)
            GameRoom.objects.filter(pk=room.pk).update(white_score=4, black_score=2)
            deliver_result(link.pk)
        self.assertEqual(post.call_args_list[0].kwargs['content'],
                         post.call_args_list[1].kwargs['content'])
        self.assertEqual(json.loads(post.call_args_list[1].kwargs['content']), frozen)
        self.assertNotEqual(post.call_args_list[0].kwargs['headers']['X-Gamelink-Nonce'],
                            post.call_args_list[1].kwargs['headers']['X-Gamelink-Nonce'])
        link.refresh_from_db()
        self.assertEqual(link.result_status, 'delivered')

    def test_natural_and_current_game_endings_are_not_normalized(self):
        room, _state, link = self.make_link()
        for reason in ('bear_off', 'move', 'give_up', 'drop', 'state_update'):
            with self.subTest(reason=reason):
                body = build_result_body(link, room, winner_color='white', end_reason=reason)
                self.assertEqual(body['score'], {'p1': 1, 'p2': 0})
                self.assertNotIn('technical_result', body)

    def test_money_direct_and_nonpositive_fixture_results_keep_existing_scoring(self):
        cases = [dict(game_format='money'), dict(tournament=0, fixture=-101),
                 dict(tournament=17, fixture=-102), dict(tournament=0, fixture=103)]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                room, _state, link = self.make_link(**arguments)
                body = build_result_body(link, room, winner_color='black', end_reason='time')
                self.assertEqual(body['score'], {'p1': 1, 'p2': 0})
                self.assertNotIn('technical_result', body)

    def test_money_timeout_keeps_cube_multiplier_and_financial_payload(self):
        room, state, link = self.make_link(
            white=0, black=0, target=1, game_format='money', tournament=0, fixture=-201,
        )
        state.update(cube=2, jacoby=True)
        match = finalize_room(room, state, 'black', 'backgammon', 'time')
        link.refresh_from_db()
        body = link.result_body
        self.assertEqual((match.white_score, match.black_score), (0, 6))
        self.assertEqual(body['score'], {'p1': 0, 'p2': 6})
        self.assertEqual(body['financial_result'], {
            'format': 'money', 'cube': 2, 'win_type': 'backgammon',
        })
        self.assertNotIn('technical_result', body)

    def test_explicit_score_and_cancelled_result_are_left_untouched(self):
        room, _state, link = self.make_link()
        explicit = {'p1': 5, 'p2': 0}
        body = build_result_body(link, room, winner_color='white', end_reason='time', score=explicit)
        self.assertEqual(explicit, {'p1': 5, 'p2': 0})
        self.assertEqual(body['score'], explicit)
        self.assertNotIn('technical_result', body)
        cancelled = build_result_body(link, room, status='cancelled', end_reason='time')
        self.assertIsNone(cancelled['winner_seat'])
        self.assertNotIn('technical_result', cancelled)

    def test_legacy_tournament_format_still_gets_a_technical_result(self):
        room, state, link = self.make_link()
        state.pop('gameFormat')
        GameState.objects.filter(room=room).update(state_data=state)
        body = build_result_body(link, room, winner_color='black', end_reason='time')
        self.assertEqual(body['score'], {'p1': 1, 'p2': 5})
        self.assertNotIn('financial_result', body)

    def test_invalid_technical_inputs_are_rejected_before_freezing(self):
        room, _state, link = self.make_link()
        for winner in (None, 'unknown'):
            with self.subTest(winner=winner), self.assertRaises(ValueError):
                build_result_body(link, room, winner_color=winner, end_reason='time')
        for target in (0, True, 32768, '5'):
            room.target_points = target
            with self.subTest(target=target), self.assertRaises(ValueError):
                build_result_body(link, room, winner_color='black', end_reason='time')
        room.target_points = 5
        for score in (-1, True, 1.5, 32768, 5):
            room.white_score = score
            with self.subTest(loser_score=score), self.assertRaises(ValueError):
                build_result_body(link, room, winner_color='black', end_reason='time')
        link.refresh_from_db()
        self.assertEqual(link.result_status, 'pending')
        self.assertIsNone(link.result_body)
        self.assertFalse(Task.objects.exists())

    def test_invalid_technical_target_rolls_back_the_entire_finalization(self):
        room, state, link = self.make_link(target=0)
        before = deepcopy(GameState.objects.get(room=room).state_data)
        with self.assertRaises(ValueError):
            finalize_room(room, state, 'black', 'single', 'time')
        room.refresh_from_db()
        link.refresh_from_db()
        self.assertEqual(room.status, 'playing')
        self.assertEqual((room.white_score, room.black_score), (1, 0))
        self.assertEqual(GameState.objects.get(room=room).state_data, before)
        self.assertEqual(link.result_status, 'pending')
        self.assertIsNone(link.result_body)
        self.assertFalse(Match.objects.exists())
        self.assertFalse(Task.objects.exists())
