"""Evidence correlation tests; no server, services or database access."""
import json
import unittest

from entry_flow_report import build_report, parse_events


class EntryReportTests(unittest.TestCase):
    def event(self, phase, second, **fields):
        return {'phase': phase, 'service': 'tournaments', 'sessionId': 'a' * 32,
                'serverAt': f'2026-10-06T00:00:{second:02d}+00:00', 'fixtureId': 2,
                'tournamentId': 1, **fields}

    def summary(self):
        return {'runId': 'run_test_123', 'tournamentId': 1, 'targetSession': 'a' * 32,
                'matches': [{'fixtureId': 2}], 'entryFlowEvents': [], 'requests': []}

    def test_notification_publication_is_correlated_to_each_handler(self):
        notification = 'c' * 32
        published = '2026-10-06T00:00:01+00:00'
        rows = [self.event('entry_change_publish_complete', 2, notificationId=notification,
                           publishedAt=published, succeeded=True, executionMs=1000),
                self.event('entry_change_received', 5, notificationId=notification,
                           publishedAt=published, seat='p1'),
                self.event('entry_change_received', 6, notificationId=notification,
                           publishedAt=published, seat='p2')]
        parsed = parse_events('\n'.join('E2E_ADMISSION ' + json.dumps(row) for row in rows),
                              'a' * 32, 'tournaments')
        notifications = build_report(self.summary(), parsed)['entryNotifications']
        self.assertEqual(notifications[0]['serverPhasesMs'], {
            'publishToHandlerMs': 4000, 'publishCallMs': 1000, 'publishCompleteToHandlerMs': 3000})
        self.assertEqual(notifications[1]['serverPhasesMs']['publishToHandlerMs'], 5000)

    def test_missing_publication_does_not_invent_a_broker_delay(self):
        rows = [self.event('entry_change_received', 5, notificationId='c' * 32)]
        phases = build_report(self.summary(), rows)['entryNotifications'][0]['serverPhasesMs']
        self.assertTrue(all(value is None for value in phases.values()))

    def test_parser_discards_secrets_other_sessions_and_raw_access_logs(self):
        event = self.event('game_seat_committed', 5, seat='p1', ticket='secret', path='?token=secret')
        text = 'GET /api/link/enter/?ticket=secret\nE2E_ADMISSION ' + json.dumps(event)
        rows = parse_events(text, 'a' * 32, 'tournaments')
        self.assertEqual(len(rows), 1)
        self.assertNotIn('secret', json.dumps(rows))
        self.assertEqual(parse_events(text, 'b' * 32, 'tournaments'), [])
        self.assertEqual(parse_events(text, 'a' * 32, 'game'), [])

    def test_report_joins_by_attempt_and_keeps_missing_evidence_null(self):
        attempt = 'b' * 32
        events = [self.event('club_entry_frame_received', 1, attemptId=attempt),
                  self.event('entry_join_received', 2, attemptId=attempt),
                  self.event('presence_join_saved', 3, attemptId=attempt, seat='p1'),
                  self.event('pair_authorization_committed', 5),
                  self.event('game_seat_committed', 8, seat='p1')]
        summary = self.summary()
        summary['entryFlowEvents'] = [{'fixtureId': 2, 'phase': 'entry_join_sent', 'browserAt': 1}]
        report = build_report(summary, events)
        one, two = report['fixtures'][0]['seats']
        self.assertEqual(one['serverPhasesMs']['asgiReceiveToConsumerMs'], 1000)
        self.assertEqual(one['serverPhasesMs']['authorizationToCommittedSeatMs'], 3000)
        self.assertIsNone(two['serverPhasesMs']['authorizationToCommittedSeatMs'])
        self.assertIsNone(report['fixtures'][0]['lastPresenceToAuthorizationMs'])

    def test_repeated_presence_of_one_seat_does_not_invent_a_pair(self):
        rows = [self.event('presence_join_saved', 1, seat='p1'), self.event('presence_join_saved', 2, seat='p1'),
                self.event('pair_authorization_committed', 4)]
        self.assertIsNone(build_report(self.summary(), rows)['fixtures'][0]['lastPresenceToAuthorizationMs'])
        rows.append(self.event('presence_join_saved', 3, seat='p2'))
        self.assertEqual(build_report(self.summary(), rows)['fixtures'][0]['lastPresenceToAuthorizationMs'], 1000)

    def test_request_queue_and_nested_spans_are_separate_from_totals(self):
        trace = 'b' * 32
        rows = [self.event('http_request_received', 1, traceId=trace),
                self.event('http_processing_started', 2, traceId=trace),
                self.event('operation_complete', 3, traceId=trace, operation='issue_ticket', sqlCount=2, sqlMs=10),
                self.event('http_processing_complete', 4, traceId=trace, operation='ticket_request',
                           seat='p1', sqlCount=5, sqlMs=30, executionMs=2000, status=200),
                self.event('http_asgi_complete', 5, traceId=trace, totalMs=4000)]
        report = build_report(self.summary(), rows)
        request = report['requests'][0]
        self.assertEqual(request['serverPhasesMs'], {'asgiToSyncMiddlewareMs': 1000,
                                                   'processingMs': 2000, 'asgiTotalMs': 4000})
        self.assertEqual(request['sqlCount'], 5)
        self.assertEqual(len(request['operations']), 1)
        self.assertEqual(report['serverMetrics']['ticket_request']['sqlCount']['mean'], 5)

    def test_connection_is_linked_to_room_without_inventing_a_seat(self):
        room = 'd830ca8f-9954-47b5-b537-79265f9b5a11'
        trace = 'b' * 32
        rows = [self.event('game_seat_committed', 1, roomId=room, seat='p1'),
                self.event('game_connection_started', 2, roomId=room, traceId=trace),
                self.event('game_socket_accepted', 3, roomId=room, traceId=trace),
                self.event('game_initial_state_sent', 4, roomId=room, traceId=trace)]
        report = build_report(self.summary(), rows)
        self.assertEqual(report['gameConnections'][0]['serverPhasesMs'],
                         {'connectionToAcceptMs': 1000, 'acceptToInitialStateMs': 1000})
        self.assertNotIn('seat', report['gameConnections'][0])

    def test_stored_availability_does_not_invent_an_observed_commit(self):
        report = build_report(self.summary(), [], [{'fixtureId': 2, 'playableAt': '2026-10-06T00:00:01.000000Z'}])
        self.assertIsNotNone(report['fixtures'][0]['serverPlayableStoredAt'])
        self.assertIsNone(report['fixtures'][0]['serverAvailableCommittedAt'])
        self.assertIsNone(report['fixtures'][0]['pairAuthorizationCommittedAt'])


if __name__ == '__main__':
    unittest.main()
