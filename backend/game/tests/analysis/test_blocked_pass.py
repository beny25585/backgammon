from datetime import datetime, timezone
from types import SimpleNamespace

from django.test import SimpleTestCase

from game.analysis.payload import _serialize_event
from game.game_service import _transcript_from_events


def event(kind, payload):
    return SimpleNamespace(
        event_type=kind, payload=payload, sequence=1, player_id=None,
        created_at=datetime(2026, 10, 29, tzinfo=timezone.utc),
    )


class BlockedPassHistoryTests(SimpleTestCase):
    def test_analysis_payload_retains_actor_and_empty_dice(self):
        for color in ('white', 'black'):
            with self.subTest(color=color):
                source = event('blocked_pass', {
                    'actorColor': color,
                    'turn': 'black' if color == 'white' else 'white',
                    'phase': 'rolling', 'dice': [], 'remaining': [],
                })
                serialized = _serialize_event(source)
                self.assertEqual(serialized['event_type'], 'blocked_pass')
                self.assertEqual(serialized['player_color'], color)
                self.assertEqual(serialized['payload']['dice'], [])
                self.assertEqual(serialized['payload']['remaining'], [])

    def test_legacy_bot_pass_is_attributed_without_fabricating_a_roll(self):
        serialized = _serialize_event(event('blocked_pass', {
            'turn': 'white', 'phase': 'rolling', 'dice': [], 'remaining': [],
        }), ai=True)
        self.assertEqual(serialized['player_color'], 'black')
        self.assertEqual(serialized['payload']['dice'], [])

    def test_transcript_keeps_the_pass_separate_from_real_rolls(self):
        transcript = _transcript_from_events([
            event('roll', {'turn': 'black', 'dice': [2, 1]}),
            event('move', {'lastMove': [{'from': 18, 'to': 20}]}),
            event('blocked_pass', {'turn': 'black', 'actorColor': 'white', 'dice': []}),
            event('roll', {'turn': 'black', 'dice': [6, 3]}),
        ])
        self.assertEqual(transcript, [
            {'turn': 'black', 'roll': [2, 1], 'moves': [{'from': 18, 'to': 20}]},
            {'kind': 'blocked_pass', 'turn': 'white', 'roll': [], 'moves': []},
            {'turn': 'black', 'roll': [6, 3], 'moves': []},
        ])
