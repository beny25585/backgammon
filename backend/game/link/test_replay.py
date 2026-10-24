import copy
import hashlib
import hmac
import json
import time
import uuid
from io import StringIO

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from game.models import GameRoom, Match, Task
from .models import TournamentLink
from .outbox import TASK_NAME, _match_details, build_result_body
from .replay import REPLAY_MAX_BYTES, replay_reference
from .signing import command_signature_base, TicketError, _validate_claims

SECRET = 'replay-review-command-secret-0123456789'


@override_settings(GAMELINK_ENABLED=True, GAMELINK_COMMAND_SECRETS=[SECRET],
                   GAMELINK_ACCEPTED_ISSUERS=['tournaments'], GAMELINK_COMMAND_CLOCK_SKEW=120)
class ReplayContractTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='RPL001', status='completed')
        self.match = Match.objects.create(room=self.room, winner='white', games=[{
            'game_number': 1, 'winner': 'white', 'points_awarded': 1,
            'transcript': [{'turn': 'white', 'roll': [6, 4], 'moves': [
                {'from': 24, 'to': 18, 'die': 6}, {'from': 13, 'to': 9, 'die': 4}]} for _ in range(800)]}])
        self.link = TournamentLink.objects.create(issuer='tournaments', tournament_id=1,
                                                  fixture_id=4, room=self.room)
        self.link.result_body = build_result_body(self.link, self.room, self.match)
        self.link.result_status = 'queued'
        self.link.save()

    def request_page(self, **changes):
        body = {'v': 1, 'action': 'read_replay', 'issuer': 'tournaments', 'fixture_id': 4, 'room_id': str(self.room.pk),
                'match_id': str(self.match.pk), 'turn_offset': 0, 'game_index': 0, **changes}
        raw = json.dumps(body).encode()
        timestamp = str(int(time.time()))
        signature = 'v1=' + hmac.new(SECRET.encode(), command_signature_base(raw, timestamp), hashlib.sha256).hexdigest()
        return self.client.post('/api/link/replay/', raw, content_type='application/json',
                                HTTP_X_GAMELINK_TIMESTAMP=timestamp, HTTP_X_GAMELINK_ISSUER='tournaments',
                                HTTP_X_GAMELINK_SIGNATURE=signature)

    def test_large_history_settles_compactly_and_all_replay_turns_remain_readable(self):
        body = self.link.result_body
        self.assertLess(len(json.dumps(body).encode()), 4096)
        self.assertNotIn('games', body['match_details'])
        turns = []
        offset = 0
        while True:
            response = self.request_page(turn_offset=offset)
            self.assertEqual(response.status_code, 200)
            self.assertLessEqual(len(response.content), REPLAY_MAX_BYTES)
            page = response.json()
            self.assertLessEqual(len(page['game']['transcript']), 50)
            turns.extend(page['game']['transcript'])
            if page['next_offset'] is None:
                break
            offset = page['next_offset']
        self.assertEqual(turns, self.match.games[0]['transcript'])

    def test_room_and_match_cannot_be_substituted_and_changed_history_is_detected(self):
        self.assertEqual(self.request_page(room_id=str(uuid.uuid4())).status_code, 404)
        self.assertEqual(self.request_page(match_id=str(uuid.uuid4())).status_code, 404)
        self.match.games[0]['transcript'][0]['roll'] = [1, 1]
        self.match.save(update_fields=['games'])
        self.assertEqual(self.request_page().status_code, 409)

    def test_replay_requires_signature_and_bounds_requests(self):
        self.assertEqual(self.client.post('/api/link/replay/', '{}', content_type='application/json').status_code, 401)
        for changes in ({'limit': 51}, {'turn_offset': -1}, {'game_index': 1}, {'action': 'finish'}, {'issuer': 'other'}):
            self.assertEqual(self.request_page(**changes).status_code, 400)

    def test_recovery_preserves_original_and_requeues_same_task_only_when_applied(self):
        original = copy.deepcopy(self.link.result_body)
        original.pop('replay')
        original['match_details'] = _match_details(self.match)
        self.link.result_body = original
        self.link.save(update_fields=['result_body'])
        task = Task.objects.create(key=f'result:{self.link.pk}', name=TASK_NAME,
                                   kwargs={'link_id': self.link.pk}, status='blocked', last_error='HTTP 413')
        call_command('compact_result_payloads', link_id=[self.link.pk], stdout=StringIO())
        self.link.refresh_from_db()
        task.refresh_from_db()
        self.assertEqual(self.link.result_body, original)
        self.assertEqual(task.status, 'blocked')
        with self.assertRaises(CommandError):
            call_command('compact_result_payloads', link_id=[self.link.pk], apply=True, stdout=StringIO())
        call_command('compact_result_payloads', link_id=[self.link.pk], apply=True,
                     reason='Isolated oversized result recovery', stdout=StringIO())
        task.refresh_from_db()
        self.link.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.delivery_payload['original_result_body'], original)
        self.assertEqual(self.link.result_body['replay'], replay_reference(self.match))
        self.assertEqual({k: v for k, v in self.link.result_body.items() if k not in ('match_details', 'replay')},
                         {k: v for k, v in original.items() if k != 'match_details'})

    def test_recovery_refuses_malformed_saved_match_identifier(self):
        original = copy.deepcopy(self.link.result_body)
        original.pop('replay')
        original['match_details'] = _match_details(self.match)
        original['match_id'] = 'malformed-match-id'
        self.link.result_body = original
        self.link.save(update_fields=['result_body'])
        Task.objects.create(key=f'result:{self.link.pk}', name=TASK_NAME, kwargs={'link_id': self.link.pk},
                            status='blocked', last_error='HTTP 413')
        with self.assertRaisesMessage(CommandError, 'invalid stored match identifier'):
            call_command('compact_result_payloads', link_id=[self.link.pk], stdout=StringIO())


@override_settings(GAMELINK_ACCEPTED_ISSUERS=['tournaments'], GAMELINK_ISSUER='backgammon')
class DynamicCubeContractTests(TestCase):
    def claims(self, **changes):
        return {'v': 1, 'iss': 'tournaments', 'aud': 'backgammon', 'jti': str(uuid.uuid4()),
                'sub': str(uuid.uuid4()), 'trn': 0, 'fix': -1, 'seat': 'p1', 'tp': 1, 'tc': 'normal',
                'exp': int(time.time()) + 120, 'format': 'money', 'cube_max': 256, 'jacoby': True,
                'dbl': True, 'stake': '100', 'loss_limit': '51200', **changes}

    def test_dynamic_money_cap_and_fixed_match_cap_remain_distinct(self):
        self.assertEqual(_validate_claims(self.claims())['cube_max'], 256)
        for changes in ({'cube_max': 255}, {'cube_max': True}, {'cube_max': 1 << 21},
                        {'format': 'match', 'jacoby': False, 'cube_max': 128}):
            with self.assertRaises(TicketError):
                _validate_claims(self.claims(**changes))
