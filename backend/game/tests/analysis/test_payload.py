"""Tests for the immutable Game -> Analysis match payload builder."""

import json
import uuid

from django.contrib.auth.models import User
from django.test import TestCase

from game.analysis.payload import (
    SCHEMA_VERSION,
    AnalysisPayloadError,
    build_match_analysis_payload,
)
from game.link.models import TournamentLink
from game.models import (
    GameEvent,
    GameRoom,
    GameState,
    Match,
    Player,
    RoomPlayer,
)


def make_players(code):
    suffix = uuid.uuid4().hex[:6]
    white_player = Player.objects.create(
        user=User.objects.create_user(username=f"{code}-w-{suffix}"))
    black_player = Player.objects.create(
        user=User.objects.create_user(username=f"{code}-b-{suffix}"))
    return white_player, black_player


def make_room(code, white_player, black_player, target_points=5,
              time_control='normal'):
    room = GameRoom.objects.create(
        id=uuid.uuid4(), code=code, status='completed',
        target_points=target_points, time_control=time_control)
    white_rp = RoomPlayer.objects.create(
        room=room, player=white_player, color='white')
    black_rp = RoomPlayer.objects.create(
        room=room, player=black_player, color='black')
    return room, white_rp, black_rp


def make_state(room, **overrides):
    state_data = {
        'gameFormat': 'match',
        'doublingAllowed': True,
        'doublingEnabled': True,
        'maxCube': 8,
        'jacoby': False,
        'crawfordGame': False,
    }
    state_data.update(overrides)
    return GameState.objects.create(room=room, state_data=state_data)


def make_match(room, white_player, black_player, games,
               winner='white', white_score=5, black_score=3,
               target_points=5):
    return Match.objects.create(
        room=room,
        white_player=white_player,
        black_player=black_player,
        games=games,
        winner=winner,
        white_score=white_score,
        black_score=black_score,
        target_points=target_points,
    )


def game_entry(game_id, game_number, winner='white', points=1,
               with_scores=True, is_crawford=False,
               score_before=None, score_after=None):
    entry = {
        'game_id': game_id,
        'game_number': game_number,
        'winner': winner,
        'win_type': 'single',
        'points_awarded': points,
        'transcript': [],
    }
    if with_scores:
        entry['score_before'] = dict(score_before or {'white': 0, 'black': 0})
        entry['score_after'] = dict(score_after or {'white': 1, 'black': 0})
        entry['is_crawford'] = is_crawford
    return entry


def add_event(room, game_id, sequence, event_type='roll', payload=None,
              player=None):
    return GameEvent.objects.create(
        room=room,
        game_id=game_id,
        sequence=sequence,
        event_type=event_type,
        payload=dict(payload or {}),
        player=player,
    )


class AnalysisPayloadSourceTests(TestCase):
    def test_private_source_without_link(self):
        white_player, black_player = make_players('PRIV')
        room, _, _ = make_room('PRIV01', white_player, black_player)
        make_state(room)
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(payload['source']['type'], 'private')
        self.assertIsNone(payload['source']['tournament_id'])
        self.assertIsNone(payload['source']['fixture_id'])

    def test_tournament_source(self):
        white_player, black_player = make_players('TRN')
        room, _, _ = make_room('TRN01', white_player, black_player)
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=482,
            room=room)
        make_state(room)
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(payload['source']['type'], 'tournament')
        self.assertEqual(payload['source']['tournament_id'], 17)
        self.assertEqual(payload['source']['fixture_id'], 482)

    def test_quick_source(self):
        white_player, black_player = make_players('QCK')
        room, _, _ = make_room('QCK01', white_player, black_player)
        TournamentLink.objects.create(
            issuer='tournaments', tournament_id=0, fixture_id=99,
            room=room)
        make_state(room)
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(payload['source']['type'], 'quick')
        self.assertIsNone(payload['source']['tournament_id'])
        self.assertEqual(payload['source']['fixture_id'], 99)


class AnalysisPayloadContentTests(TestCase):
    def _base_match(self, code='BASE', **state_overrides):
        white_player, black_player = make_players(code)
        room, white_rp, black_rp = make_room(code + '01', white_player,
                                             black_player)
        make_state(room, **state_overrides)
        return white_player, black_player, room, white_rp, black_rp

    def test_player_pks_used_not_user_ids(self):
        # Offset User PKs away from Player PKs so the assertion is sharp.
        User.objects.create_user(username='dummy-a')
        User.objects.create_user(username='dummy-b')
        white_player, black_player = make_players('PK')
        room, _, _ = make_room('PK01', white_player, black_player)
        make_state(room)
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(
            payload['players']['white']['player_id'], white_player.pk)
        self.assertEqual(payload['players']['white']['name'], str(white_player))
        self.assertEqual(payload['players']['black']['name'], str(black_player))
        self.assertEqual(
            payload['players']['black']['player_id'], black_player.pk)
        self.assertNotEqual(
            payload['players']['white']['player_id'],
            white_player.user_id)
        self.assertNotEqual(
            payload['players']['black']['player_id'],
            black_player.user_id)

    def test_complete_rule_contract(self):
        white_player, black_player, room, _, _ = self._base_match(
            code='RULE', maxCube=8, jacoby=False, doublingAllowed=True)
        room.time_control = 'fast'
        room.save()
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0, target_points=7,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(payload['rules'], {
            'format': 'match',
            'target_points': 7,
            'time_control': 'fast',
            'doubling_enabled': True,
            'max_cube_value': 8,
            'jacoby': False,
            'beaver': False,
        })

    def test_crawford_temporary_doubling_enabled_does_not_redefine_rule(self):
        white_player, black_player, room, _, _ = self._base_match(
            code='CRW', doublingAllowed=True, doublingEnabled=False,
            crawfordGame=True)
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1, is_crawford=True)],
            white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1,
                  payload={'turn': 'white', 'crawfordGame': True})

        payload = build_match_analysis_payload(match)

        self.assertTrue(payload['rules']['doubling_enabled'])
        self.assertTrue(payload['games'][0]['is_crawford'])

    def test_two_games_receive_isolated_events(self):
        white_player, black_player, room, _, _ = self._base_match(code='ISO')
        match = make_match(
            room, white_player, black_player,
            [game_entry('game-a', 1,
                        score_before={'white': 0, 'black': 0},
                        score_after={'white': 1, 'black': 0}),
             game_entry('game-b', 2, winner='black',
                        score_before={'white': 1, 'black': 0},
                        score_after={'white': 1, 'black': 2})],
            winner='black', white_score=1, black_score=2,
        )
        add_event(room, 'game-a', 1, payload={'dice': [6, 6]})
        add_event(room, 'game-a', 2, payload={'dice': [1, 1]})
        add_event(room, 'game-b', 3, payload={'dice': [3, 2]})

        payload = build_match_analysis_payload(match)

        game_a = payload['games'][0]
        game_b = payload['games'][1]
        self.assertEqual(
            [e['payload'] for e in game_a['events']],
            [{'dice': [6, 6]}, {'dice': [1, 1]}])
        self.assertEqual(
            [e['payload'] for e in game_b['events']],
            [{'dice': [3, 2]}])

    def test_event_serialization_and_player_color(self):
        white_player, black_player, room, white_rp, _ = self._base_match(
            code='EVT')
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            white_score=1, black_score=0,
        )
        snapshot = {'points': [2] + [0] * 23, 'turn': 'white', 'dice': [3, 2]}
        event = add_event(room, 'g1', 7, event_type='move',
                          payload=snapshot, player=white_rp)
        add_event(room, 'g1', 8, event_type='roll',
                  payload={'turn': 'black', 'dice': [5, 1]})

        payload = build_match_analysis_payload(match)

        first, second = payload['games'][0]['events']
        self.assertEqual(first['sequence'], 7)
        self.assertEqual(first['event_type'], 'move')
        self.assertEqual(first['player_color'], 'white')
        self.assertEqual(first['payload'], snapshot)
        self.assertIsInstance(first['created_at'], str)
        self.assertEqual(first['created_at'], event.created_at.isoformat())
        self.assertIsNone(second['player_color'])

    def test_score_preservation_exact(self):
        white_player, black_player, room, _, _ = self._base_match(code='SCR')
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1,
                        score_before={'white': 2, 'black': 3},
                        score_after={'white': 4, 'black': 3})],
            winner='white', white_score=4, black_score=3,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(
            payload['games'][0]['score_before'], {'white': 2, 'black': 3})
        self.assertEqual(
            payload['games'][0]['score_after'], {'white': 4, 'black': 3})

    def test_legacy_score_fallback(self):
        white_player, black_player, room, _, _ = self._base_match(code='LEG')
        match = make_match(
            room, white_player, black_player,
            [game_entry('old-1', 1, winner='white', points=1,
                        with_scores=False),
             game_entry('old-2', 2, winner='black', points=2,
                        with_scores=False)],
            winner='black', white_score=1, black_score=2,
        )
        add_event(room, 'old-1', 1, payload={'turn': 'white'})
        add_event(room, 'old-2', 2, payload={'turn': 'black'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(
            payload['games'][0]['score_before'], {'white': 0, 'black': 0})
        self.assertEqual(
            payload['games'][0]['score_after'], {'white': 1, 'black': 0})
        self.assertEqual(
            payload['games'][1]['score_before'], {'white': 1, 'black': 0})
        self.assertEqual(
            payload['games'][1]['score_after'], {'white': 1, 'black': 2})

    def test_legacy_crawford_fallback_from_event_payload(self):
        white_player, black_player, room, _, _ = self._base_match(code='LCR')
        match = make_match(
            room, white_player, black_player,
            [game_entry('old-1', 1, with_scores=False)],
            white_score=1, black_score=0,
        )
        add_event(room, 'old-1', 1, payload={'turn': 'white'})
        add_event(room, 'old-1', 2,
                  payload={'turn': 'white', 'crawfordGame': True})

        payload = build_match_analysis_payload(match)

        self.assertTrue(payload['games'][0]['is_crawford'])

    def test_payload_json_serializable_and_envelope(self):
        white_player, black_player, room, _, _ = self._base_match(code='JSN')
        match = make_match(
            room, white_player, black_player,
            [game_entry('g1', 1)],
            winner='white', white_score=1, black_score=0,
        )
        add_event(room, 'g1', 1, payload={'turn': 'white'})

        payload = build_match_analysis_payload(match)

        self.assertEqual(payload['schema_version'], SCHEMA_VERSION)
        self.assertEqual(payload['match_id'], str(match.id))
        self.assertEqual(payload['room_id'], str(room.id))
        self.assertEqual(payload['result'], {
            'winner': 'white', 'white_score': 1, 'black_score': 0})
        json.dumps(payload)


class AnalysisPayloadInvalidTests(TestCase):
    def test_invalid_matches_raise(self):
        white_player, black_player = make_players('INV')
        room, _, _ = make_room('INV01', white_player, black_player)
        make_state(room)
        valid_games = [game_entry('g1', 1)]

        no_room = make_match(
            room, white_player, black_player, list(valid_games),
            white_score=1, black_score=0,
        )
        no_room.room = None
        with self.assertRaises(AnalysisPayloadError):
            build_match_analysis_payload(no_room)

        no_players = make_match(
            room, white_player, black_player, list(valid_games),
            white_score=1, black_score=0,
        )
        no_players.white_player = None
        with self.assertRaises(AnalysisPayloadError):
            build_match_analysis_payload(no_players)

        no_games = make_match(
            room, white_player, black_player, [],
            white_score=0, black_score=0,
        )
        with self.assertRaises(AnalysisPayloadError):
            build_match_analysis_payload(no_games)

        lonely_room, _, _ = make_room(
            'INV02', white_player, black_player)
        lonely_match = make_match(
            lonely_room, white_player, black_player, list(valid_games),
            white_score=1, black_score=0,
        )
        with self.assertRaises(AnalysisPayloadError):
            build_match_analysis_payload(lonely_match)

