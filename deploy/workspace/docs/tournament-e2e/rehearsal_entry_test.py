"""Guard and observer tests; no Django, database, Docker or network startup."""
import copy
import unittest
from unittest.mock import patch

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context
from rehearsal_entry import AdmissionASGI, Queries, context, validate_settings


class EntryObserverTests(unittest.TestCase):
    def setUp(self):
        self.identity = {'session_id': 'a' * 32, 'origin': ORIGIN, 'project': PROJECT,
                         'database_context': fresh_database_context('a' * 32)}
        self.database = {'ENGINE': 'django.db.backends.postgresql', 'HOST': 'postgres',
                         'NAME': 'backgammon_tournaments_e2e_' + 'a' * 12, 'USER': 'backgammon_tournaments'}

    def test_only_the_fresh_rehearsal_context_is_accepted(self):
        validate_settings(self.identity, 'tournaments', self.database, 'redis://redis:6379/9')
        for key, value in (('NAME', 'backgammon_tournaments'), ('HOST', 'localhost'), ('USER', 'postgres'),
                           ('ENGINE', 'django.db.backends.sqlite3')):
            database = {**self.database, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_settings(self.identity, 'tournaments', database, 'redis://redis:6379/9')
        identity = copy.deepcopy(self.identity)
        identity['origin'] = ORIGIN.replace(':18443', '')
        with self.assertRaises(ValueError):
            validate_settings(identity, 'tournaments', self.database, 'redis://redis:6379/9')
        with self.assertRaises(ValueError):
            validate_settings(self.identity, 'tournaments', self.database, 'redis://redis:6379/0')

    def test_sql_observer_executes_once_and_retains_no_sql_or_parameters(self):
        metrics = Queries()
        calls = []
        def execute(*args):
            calls.append(args)
            return 'unchanged'
        with patch('rehearsal_entry.perf_counter', side_effect=[1, 1.025]):
            self.assertEqual(metrics(execute, 'SELECT secret FROM t FOR UPDATE', ['password'], False, {}), 'unchanged')
        self.assertEqual(len(calls), 1)
        self.assertEqual(metrics.fields(), {'sqlCount': 1, 'sqlMs': 25.0,
                                          'lockStatementCount': 1, 'lockStatementMs': 25.0})
        self.assertNotIn('password', repr(vars(metrics)))
        self.assertNotIn('secret', repr(vars(metrics)))

    def test_query_errors_propagate_without_retry_or_conversion(self):
        metrics = Queries()
        def execute(*_args):
            raise RuntimeError('original error')
        with self.assertRaisesRegex(RuntimeError, 'original error'):
            metrics(execute, 'SELECT 1', [], False, {})
        self.assertEqual(metrics.sql_count, 1)


class ASGIObserverTests(unittest.IsolatedAsyncioTestCase):
    async def test_game_frames_and_errors_pass_through_unchanged(self):
        import json
        sent = []
        emitted = []
        frames = [{'type': 'websocket.accept'},
                  {'type': 'websocket.send', 'text': json.dumps({'type': 'state_update', 'initial': True, 'payload': {'private': 'unchanged'}})},
                  {'type': 'websocket.send', 'text': '{malformed'},
                  {'type': 'websocket.send', 'text': json.dumps({'type': 'state_update', 'initial': True})}]
        async def app(scope, receive, send):
            for frame in frames:
                await send(frame)
            raise RuntimeError('application failure')
        async def send(frame):
            sent.append(frame)
        async def receive():
            return {'type': 'websocket.connect'}
        with patch('rehearsal_entry.emit', side_effect=lambda phase, **fields: emitted.append(phase)):
            with self.assertRaisesRegex(RuntimeError, 'application failure'):
                await AdmissionASGI(app)({'type': 'websocket', 'path': '/ws/game/d830ca8f-9954-47b5-b537-79265f9b5a11/'}, receive, send)
        self.assertEqual(sent, frames)
        self.assertEqual(emitted, ['game_connection_started', 'game_socket_accepted', 'game_initial_state_sent'])
        self.assertIsNone(context.get())

    async def test_club_receive_preserves_bytes_and_does_not_add_a_message(self):
        import json
        payload = {'type': 'entry_join', 'attempt_id': 'b' * 32, 'tournament_id': 1, 'fixture_id': 2,
                   'ticket': 'must never appear in diagnostics'}
        message = {'type': 'websocket.receive', 'text': json.dumps(payload)}
        incoming = []
        events = []
        async def receive():
            incoming.append(message)
            return message
        async def app(scope, wrapped_receive, send):
            self.assertIs(await wrapped_receive(), message)
        async def send(_message):
            self.fail('The observer must not manufacture a response')
        with patch('rehearsal_entry.emit', side_effect=lambda phase, **fields: events.append((phase, dict(context.get() or {})))):
            await AdmissionASGI(app)({'type': 'websocket', 'path': '/ws/club/updates/'}, receive, send)
        self.assertEqual(incoming, [message])
        self.assertEqual(events, [('club_entry_frame_received', {'attemptId': 'b' * 32, 'tournamentId': 1, 'fixtureId': 2})])
        self.assertIsNone(context.get())


if __name__ == '__main__':
    unittest.main()
