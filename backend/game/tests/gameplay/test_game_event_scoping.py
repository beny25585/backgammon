"""Per-game scoping of GameEvent rows and transcripts.

Every GameEvent belongs to one explicit game. Transcripts built at game
end must never contain events from another game in the same room.
"""

import uuid

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase

from game.consumers import event_game_id, record_event_and_advance
from game.engine import BackgammonEngine
from game.game_service import _match_metadata, record_game_end
from game.models import GameEvent, GameRoom, Player, RoomPlayer


def make_room(code, target_points=7):
    suffix = uuid.uuid4().hex[:6]
    white_player = Player.objects.create(
        user=User.objects.create_user(username=f"{code}-w-{suffix}"))
    black_player = Player.objects.create(
        user=User.objects.create_user(username=f"{code}-b-{suffix}"))
    room = GameRoom.objects.create(
        id=uuid.uuid4(), code=code, status='playing',
        target_points=target_points)
    RoomPlayer.objects.create(
        room=room, player=white_player, color='white')
    RoomPlayer.objects.create(
        room=room, player=black_player, color='black')
    return room


class GameIdGenerationTests(TestCase):
    def test_new_games_get_unique_game_ids(self):
        first = BackgammonEngine.get_initial_state()
        second = BackgammonEngine.get_initial_state()

        for state in (first, second):
            self.assertIn('gameId', state)
            self.assertIsInstance(state['gameId'], str)
            # Must be a real UUID, not a legacy placeholder.
            uuid.UUID(state['gameId'])

        self.assertNotEqual(first['gameId'], second['gameId'])


class EventGameIdStampingTests(TestCase):
    def test_event_persistence_stamps_payload_game_id(self):
        room = make_room('STAMP1')
        payload = {
            'gameId': 'game-a',
            'turn': 'white',
            'dice': [3, 2],
            'phase': 'moving',
        }
        async_to_sync(record_event_and_advance)(room, 'white', 'roll', payload)

        event = GameEvent.objects.get(room=room)
        self.assertEqual(event.game_id, 'game-a')
        self.assertEqual(event_game_id(payload), 'game-a')

    def test_legacy_missing_game_id_falls_back_to_initial(self):
        room = make_room('STAMP2')
        payload = {'turn': 'white', 'dice': [3, 2], 'phase': 'moving'}
        async_to_sync(record_event_and_advance)(room, 'white', 'roll', payload)

        event = GameEvent.objects.get(room=room)
        self.assertEqual(event.game_id, 'initial')
        self.assertEqual(event_game_id(payload), 'initial')
        self.assertEqual(event_game_id(None), 'initial')


class TranscriptScopingTests(TestCase):
    def _seed_two_games(self, room):
        GameEvent.objects.create(
            room=room, game_id='game-a', sequence=1, event_type='roll',
            payload={'turn': 'white', 'dice': [6, 6]},
        )
        GameEvent.objects.create(
            room=room, game_id='game-a', sequence=2, event_type='move',
            payload={'turn': 'white',
                     'lastMove': [{'from': 12, 'to': 6}]},
        )
        GameEvent.objects.create(
            room=room, game_id='game-a', sequence=3, event_type='end_turn',
            payload={'turn': 'white'},
        )
        GameEvent.objects.create(
            room=room, game_id='game-b', sequence=4, event_type='roll',
            payload={'turn': 'white', 'dice': [3, 2]},
        )
        GameEvent.objects.create(
            room=room, game_id='game-b', sequence=5, event_type='move',
            payload={'turn': 'white',
                     'lastMove': [{'from': 5, 'to': 2}]},
        )
        GameEvent.objects.create(
            room=room, game_id='game-b', sequence=6, event_type='end_turn',
            payload={'turn': 'white'},
        )

    def test_transcript_does_not_mix_games(self):
        room = make_room('SCOPE1')
        self._seed_two_games(room)

        state = {'gameId': 'game-b', 'cube': 1}
        result = record_game_end(room, state, 'white', 'single', 'bear_off')
        self.assertIsNotNone(result)

        room.refresh_from_db()
        transcript = room.state['match']['games'][0]['transcript']
        rolls = [turn.get('roll') for turn in transcript]
        moves = [m for turn in transcript for m in turn.get('moves', [])]

        # Game B content is present...
        self.assertIn([3, 2], rolls)
        self.assertIn({'from': 5, 'to': 2}, moves)
        # ...and no Game A content leaked in.
        self.assertNotIn([6, 6], rolls)
        self.assertNotIn({'from': 12, 'to': 6}, moves)

    def test_match_metadata_aggregates_room_wide_but_transcript_is_scoped(self):
        room = make_room('SCOPE2')
        self._seed_two_games(room)
        # One double offered+accepted in each game.
        GameEvent.objects.create(
            room=room, game_id='game-a', sequence=7, event_type='double',
            payload={'turn': 'white'},
        )
        GameEvent.objects.create(
            room=room, game_id='game-a', sequence=8,
            event_type='double_response',
            payload={'turn': 'black', 'phase': 'moving'},
        )
        GameEvent.objects.create(
            room=room, game_id='game-b', sequence=9, event_type='double',
            payload={'turn': 'white'},
        )
        GameEvent.objects.create(
            room=room, game_id='game-b', sequence=10,
            event_type='double_response',
            payload={'turn': 'black', 'phase': 'moving'},
        )

        metadata, transcript = _match_metadata(
            room, {'gameId': 'game-b', 'cube': 1}, 'bear_off')

        rolls = [turn.get('roll') for turn in transcript]
        self.assertIn([3, 2], rolls)
        self.assertNotIn([6, 6], rolls)
        # Room-wide aggregates still see both games.
        self.assertEqual(metadata['doubles_offered'], 2)
        self.assertEqual(metadata['doubles_accepted'], 2)
