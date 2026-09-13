"""Versioned direct-game forfeit policy, including real disconnect settlement."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase, TestCase, TransactionTestCase

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.formats import apply_ticket, forfeit_win_type
from game.game_service import _points_for
from game.models import GameRoom, GameState, Match
from game.link.models import TournamentLink
from game.presence import check_room_presence, mark_connected, mark_disconnected, mark_heartbeat


def board(loser='white', result='backgammon', game_format='money'):
    state = BackgammonEngine.get_initial_state()
    apply_ticket(state, dict(format=game_format, cube_max=8, jacoby=game_format == 'money',
                             stake='100', loss_limit='800', dbl=True, tp=5 if game_format == 'match' else 1))
    state.update(phase='moving', points=[0] * 24, cube=2)
    sign = 1 if loser == 'white' else -1
    state['points'][10] = 15 * sign
    if result == 'single':
        state['home'][loser] = 1
        state['points'][10] = 14 * sign
    if result == 'backgammon':
        state['points'][10] = 14 * sign
        state['bar'][loser] = 1
    return state


class ForfeitPolicyTests(SimpleTestCase):
    def test_all_money_exit_reasons_share_board_classification_for_both_colors(self):
        for loser in ('white', 'black'):
            for result in ('single', 'gammon', 'backgammon'):
                for reason in ('give_up', 'leave', 'time', 'disconnect'):
                    with self.subTest(loser=loser, result=result, reason=reason):
                        self.assertEqual(forfeit_win_type(board(loser, result), loser, reason=reason), result)

    def test_checker_in_winners_home_counts_even_without_a_checker_on_bar(self):
        for loser, index, sign in (('white', 18, 1), ('black', 5, -1)):
            state = board(loser, 'gammon')
            state['points'][10] -= sign
            state['points'][index] = sign
            self.assertEqual(forfeit_win_type(state, loser, reason='disconnect'), 'backgammon')
            state['points'][index] = -sign
            self.assertEqual(forfeit_win_type(state, loser, reason='disconnect'), 'gammon')

    def test_match_give_up_uses_board_but_series_abandonment_retains_fallback(self):
        state = board(game_format='match')
        state.update(crawfordGame=True, doublingEnabled=False, cube=1)
        self.assertEqual(forfeit_win_type(state, 'white', 'gammon', reason='give_up'), 'backgammon')
        self.assertEqual(_points_for(state, 'backgammon'), 3)
        self.assertTrue(state['crawfordGame'])
        self.assertFalse(state['doublingEnabled'])
        for reason in ('leave', 'time', 'disconnect'):
            self.assertEqual(forfeit_win_type(state, 'white', reason=reason), 'single')
        state.pop('gameFormat')
        self.assertEqual(forfeit_win_type(state, 'white', 'gammon', reason='give_up'), 'gammon')
        self.assertEqual(forfeit_win_type(state, 'white', reason='disconnect'), 'single')

    def test_drop_and_jacoby_are_separate_from_board_classification(self):
        state = board()
        for cube, expected_points in ((1, 1), (2, 6), (8, 24)):
            state['cube'] = cube
            result = forfeit_win_type(state, 'white', reason='disconnect')
            self.assertEqual(result, 'backgammon')
            self.assertEqual(_points_for(state, result), expected_points)
            self.assertEqual(forfeit_win_type(state, 'white', 'backgammon', reason='drop'), 'single')
        state.update(phase='rolling', turn='black', cube=2)
        engine = BackgammonEngine(state)
        self.assertTrue(engine.offer_double('black')['success'])
        self.assertTrue(engine.respond_to_double(False, 'white')['success'])
        self.assertEqual(state['winType'], 'single')
        self.assertEqual(state['cube'], 2)

    def test_consumer_routes_money_exits_with_same_result_and_correct_scope(self):
        for reason in ('give_up', 'leave', 'time'):
            consumer = GameConsumer()
            consumer.room_id = 'forfeit-policy'
            consumer.player_color = 'white'
            consumer._finalize_and_broadcast = AsyncMock()
            consumer._send_error = AsyncMock()
            room = SimpleNamespace(status='playing', state={})
            with patch('game.consumers.get_room', AsyncMock(return_value=room)), patch(
                'game.consumers.get_game_state', AsyncMock(return_value=SimpleNamespace(state_data=board()))
            ):
                if reason == 'time':
                    async_to_sync(consumer._forfeit_on_time)('black', 'white')
                else:
                    async_to_sync(getattr(consumer, '_handle_' + reason))()
            args, kwargs = consumer._finalize_and_broadcast.await_args
            self.assertEqual(args[1:], ('black', 'backgammon', reason))
            self.assertEqual(kwargs.get('force_close', False), reason != 'give_up')


class DisconnectMoneySettlementTests(TestCase):
    def test_disconnect_records_multiplier_after_grace_and_is_idempotent(self):
        for loser in ('white', 'black'):
            with self.subTest(loser=loser):
                winner = 'black' if loser == 'white' else 'white'
                room = GameRoom.objects.create(code='EXIT' + loser, status='playing', target_points=1)
                GameState.objects.create(room=room, state_data=board(loser))
                link = TournamentLink.objects.create(
                    issuer='tournaments', fixture_id=-1 if loser == 'white' else -2,
                    tournament_id=0, room=room,
                )
                mark_connected(room.id, 'white', 'white', 1000)
                mark_connected(room.id, 'black', 'black', 1000)
                mark_disconnected(room.id, loser, 1001)
                mark_heartbeat(room.id, winner, 1040)
                self.assertEqual(check_room_presence(room.id, 1040)['status'], 'waiting')
                mark_heartbeat(room.id, winner, 1041)
                with patch('game.presence.get_channel_layer') as layer:
                    layer.return_value.group_send = AsyncMock()
                    self.assertEqual(check_room_presence(room.id, 1041)['status'], 'forfeited')
                payload = layer.return_value.group_send.await_args.args[1]['payload']
                self.assertEqual(payload['winType'], 'backgammon')
                self.assertTrue(payload['matchOver'])
                saved = GameState.objects.get(room=room).state_data
                self.assertEqual(saved['gameEndReason'], 'disconnect')
                self.assertEqual(saved['winType'], 'backgammon')
                match = Match.objects.get(room=room)
                self.assertEqual(getattr(match, winner + '_score'), 6)
                self.assertEqual(check_room_presence(room.id, 1100)['status'], 'closed')
                self.assertEqual(Match.objects.filter(room=room).count(), 1)
                link.refresh_from_db()
                self.assertEqual(link.result_body['financial_result'], {
                    'format': 'money', 'cube': 2, 'win_type': 'backgammon',
                })
                self.assertEqual(link.result_body['end_reason'], 'disconnect')


class MatchForfeitConsumerTests(TransactionTestCase):
    @patch('game.link.outbox.try_deliver_now')
    def test_give_up_then_leave_between_games_closes_series_without_rescoring(self, deliver):
        room = GameRoom.objects.create(code='SEREXIT', status='playing', target_points=9)
        state = board(game_format='match')
        state['gameId'] = 'first-game'
        GameState.objects.create(room=room, state_data=state)
        link = TournamentLink.objects.create(issuer='tournaments', fixture_id=-3, tournament_id=0, room=room)
        consumer = GameConsumer()
        consumer.room_id = str(room.id)
        consumer.room_group_name = f'game_{room.id}'
        consumer.player_color = 'white'
        consumer.channel_layer = SimpleNamespace(group_send=AsyncMock())
        consumer._arm_auto_next_game = AsyncMock()
        async_to_sync(consumer._handle_give_up)()
        first_payload = consumer.channel_layer.group_send.await_args.args[1]['payload']
        self.assertFalse(first_payload['matchOver'])
        self.assertEqual(first_payload['winType'], 'backgammon')
        self.assertEqual(first_payload['points'], 6)
        room.refresh_from_db()
        original_games = room.state['match']['games']
        self.assertEqual(room.black_score, 6)
        self.assertEqual(room.status, 'playing')
        link.refresh_from_db()
        self.assertEqual(link.result_status, 'pending')
        deliver.assert_not_called()
        async_to_sync(consumer._handle_leave)()
        payload = consumer.channel_layer.group_send.await_args.args[1]['payload']
        self.assertTrue(payload['matchOver'])
        self.assertFalse(payload['nextGame'])
        self.assertEqual(payload['reason'], 'leave')
        self.assertEqual(payload['points'], 0)
        room.refresh_from_db()
        self.assertEqual(room.status, 'completed')
        self.assertEqual(room.black_score, 6)
        match = Match.objects.get(room=room)
        self.assertEqual(match.games, original_games)
        link.refresh_from_db()
        self.assertEqual(link.result_body['end_reason'], 'leave')
        self.assertEqual(link.result_body['score']['p2'], 6)
        self.assertEqual(link.result_body['financial_result']['format'], 'match')
        deliver.assert_called_once()

    @patch('game.link.outbox.try_deliver_now')
    def test_money_consumer_endings_freeze_board_multiplier_before_jacoby(self, deliver):
        for index, reason in enumerate(('give_up', 'leave', 'time')):
            with self.subTest(reason=reason):
                room = GameRoom.objects.create(code='OUT' + str(index), status='playing', target_points=1)
                state = board()
                state['cube'] = 1
                GameState.objects.create(room=room, state_data=state)
                link = TournamentLink.objects.create(
                    issuer='tournaments', fixture_id=-10-index, tournament_id=0, room=room,
                )
                consumer = GameConsumer()
                consumer.room_id = str(room.id)
                consumer.room_group_name = f'game_{room.id}'
                consumer.player_color = 'white'
                consumer.channel_layer = SimpleNamespace(group_send=AsyncMock())
                if reason == 'time':
                    async_to_sync(consumer._forfeit_on_time)('black', 'white')
                else:
                    async_to_sync(getattr(consumer, '_handle_' + reason))()
                link.refresh_from_db()
                self.assertEqual(link.result_body['end_reason'], reason)
                self.assertEqual(link.result_body['financial_result'], {
                    'format': 'money', 'cube': 1, 'win_type': 'backgammon',
                })
                self.assertEqual(Match.objects.get(room=room).black_score, 1)
