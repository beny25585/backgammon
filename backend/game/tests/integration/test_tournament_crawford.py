"""Crawford survives tournament ticket redemption and real game transitions."""
import uuid

from asgiref.sync import async_to_sync
from django.test import TransactionTestCase

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.game_service import record_game_end
from game.link.models import TournamentLink
from game.link.tests import ENTER_URL, link_settings, make_ticket
from game.models import GameState


@link_settings
class TournamentCrawfordTests(TransactionTestCase):
    def redeem(self, **claims):
        claims.setdefault('tp', 9)
        response = self.client.get(ENTER_URL, {'ticket': make_ticket(**claims)})
        self.assertEqual(response.status_code, 302)
        return TournamentLink.objects.get(fixture_id=claims.get('fix', 482)).room

    def start_at(self, white, black, **claims):
        room = self.redeem(**claims)
        room.status = 'playing'
        room.white_score, room.black_score = white, black
        room.save(update_fields=['status', 'white_score', 'black_score'])
        return room, GameState.objects.get(room=room).state_data

    def finish_and_advance(self, room, state, winner, game_id, win_type='single'):
        state.update(phase='game_over', winner=winner, winType=win_type)
        result = record_game_end(room, state, winner, win_type, 'bear_off')
        self.assertIsNotNone(result)
        self.assertFalse(result['match_over'])
        room.refresh_from_db()
        engine = BackgammonEngine(GameState.objects.get(room=room).state_data)
        consumer = GameConsumer()
        consumer.room_id = str(room.pk)
        self.assertEqual(
            async_to_sync(consumer._handle_next_game)(engine), {'success': True},
        )
        engine.state['gameId'] = game_id
        GameState.objects.filter(room=room).update(state_data=engine.state)
        return engine.state

    def test_tournament_ticket_initializes_both_persisted_state_copies(self):
        room = self.redeem()
        for state in (room.state, GameState.objects.get(room=room).state_data):
            with self.subTest(state_keys=tuple(state)):
                self.assertTrue(state['crawfordEnabled'])
                self.assertTrue(state['doublingAllowed'])
                self.assertTrue(state['doublingEnabled'])
                self.assertFalse(state['crawfordGame'])
                self.assertFalse(state['crawfordUsed'])
                for key in ('gameFormat', 'stake', 'lossLimit', 'jacoby'):
                    self.assertNotIn(key, state)

    def test_8_4_blocks_both_players_and_8_5_restores_trailing_players_cube(self):
        room, state = self.start_at(7, 4)
        crawford = self.finish_and_advance(room, state, 'white', 'crawford')
        self.assertEqual((room.white_score, room.black_score), (8, 4))
        self.assertTrue(crawford['crawfordGame'])
        self.assertFalse(crawford['doublingEnabled'])
        for color in ('white', 'black'):
            with self.subTest(color=color):
                restored = BackgammonEngine._clone_state(crawford)
                self.assertTrue(restored['crawfordEnabled'])
                self.assertTrue(restored['doublingAllowed'])
                restored.update(phase='rolling', turn=color)
                self.assertFalse(BackgammonEngine(restored).offer_double(
                    color, target_points=room.target_points,
                    scores={'white': room.white_score, 'black': room.black_score},
                )['success'])

        post_crawford = self.finish_and_advance(
            room, crawford, 'black', 'post-crawford',
        )
        self.assertEqual((room.white_score, room.black_score), (8, 5))
        self.assertFalse(post_crawford['crawfordGame'])
        self.assertTrue(post_crawford['crawfordUsed'])
        self.assertTrue(post_crawford['doublingEnabled'])
        post_crawford.update(phase='rolling', turn='black')
        self.assertTrue(BackgammonEngine(post_crawford).offer_double(
            'black', target_points=room.target_points,
            scores={'white': room.white_score, 'black': room.black_score},
        )['success'])

    def test_other_player_reaching_one_away_does_not_repeat_crawford(self):
        room, state = self.start_at(7, 4)
        crawford = self.finish_and_advance(room, state, 'white', 'crawford')
        post_crawford = self.finish_and_advance(
            room, crawford, 'black', 'post-crawford',
        )
        double_match_point = self.finish_and_advance(
            room, post_crawford, 'black', 'double-match-point', 'backgammon',
        )
        self.assertEqual((room.white_score, room.black_score), (8, 8))
        self.assertTrue(double_match_point['crawfordUsed'])
        self.assertFalse(double_match_point['crawfordGame'])
        self.assertTrue(double_match_point['doublingEnabled'])

    def test_initially_disabled_cube_stays_disabled_after_crawford(self):
        room, state = self.start_at(7, 4, dbl=False)
        crawford = self.finish_and_advance(room, state, 'white', 'crawford')
        restored = BackgammonEngine._clone_state(crawford)
        self.assertFalse(restored['doublingAllowed'])
        post_crawford = self.finish_and_advance(
            room, restored, 'black', 'post-crawford',
        )
        self.assertFalse(post_crawford['crawfordGame'])
        self.assertTrue(post_crawford['crawfordUsed'])
        self.assertFalse(post_crawford['doublingEnabled'])

    def test_one_point_tournament_cannot_double(self):
        room = self.redeem(tp=1)
        for state in (room.state, GameState.objects.get(room=room).state_data):
            self.assertTrue(state['crawfordGame'])
            self.assertFalse(state['doublingEnabled'])
            state.update(phase='rolling', turn='black')
            self.assertFalse(BackgammonEngine(state).offer_double('black')['success'])

    def test_waiting_room_receives_policy_from_a_fresh_ticket(self):
        subject = str(uuid.uuid4())
        room = self.redeem(sub=subject)
        legacy = dict(room.state)
        for key in ('crawfordEnabled', 'crawfordGame', 'crawfordUsed', 'doublingAllowed'):
            legacy.pop(key)
        room.state = legacy
        room.save(update_fields=['state'])
        GameState.objects.filter(room=room).update(state_data=legacy)

        self.redeem(sub=subject, tp=7, dbl=False)
        room.refresh_from_db()
        self.assertEqual(room.target_points, 7)
        for state in (room.state, GameState.objects.get(room=room).state_data):
            self.assertTrue(state['crawfordEnabled'])
            self.assertFalse(state['doublingAllowed'])
            self.assertFalse(state['doublingEnabled'])

    def test_legacy_direct_ticket_does_not_gain_tournament_policy(self):
        room, state = self.start_at(7, 4, trn=0, fix=-482)
        fresh = self.finish_and_advance(room, state, 'white', 'legacy-next')
        self.assertNotIn('crawfordEnabled', fresh)
        self.assertFalse(fresh.get('crawfordGame', False))
        self.assertTrue(fresh['doublingEnabled'])

    def test_money_ticket_keeps_its_one_point_cube_enabled(self):
        room = self.redeem(
            trn=0, fix=-482, tp=1, format='money', cube_max=8, jacoby=True,
            stake='100.00', loss_limit='800.00',
        )
        state = GameState.objects.get(room=room).state_data
        self.assertNotIn('crawfordEnabled', state)
        self.assertFalse(state['crawfordGame'])
        self.assertTrue(state['doublingEnabled'])
        state.update(phase='rolling', turn='black')
        self.assertTrue(BackgammonEngine(state).offer_double('black')['success'])
