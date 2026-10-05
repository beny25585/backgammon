"""Pure Nginx policy tests; no subprocess, Docker, Django, database or network access."""
import json
import unittest

from rehearsal_context import fresh_database_context, ORIGIN, PROJECT
from server_rehearsal import nginx, UPSTREAM_PORTS, upstreams_for_addresses, validate_listener_response


class RehearsalNginxTests(unittest.TestCase):
    def setUp(self):
        session_id = 'a' * 32
        self.identity = {'session_id': session_id, 'project': PROJECT, 'origin': ORIGIN,
                         'database_context': fresh_database_context(session_id)}
        self.addresses = {service: f'172.25.0.{index}' for index, service in enumerate(UPSTREAM_PORTS, 2)}
        self.upstreams = upstreams_for_addresses(self.addresses, ['172.25.0.0/24'])

    def response(self, payload, status=200, cookie=False, content_type='application/json'):
        headers = [f'HTTP/1.1 {status} Response', 'Content-Type: ' + content_type]
        if cookie:
            headers.append('Set-Cookie: csrftoken=test-token; Path=/; Secure; SameSite=Lax')
        body = json.dumps(payload) if content_type == 'application/json' else payload
        return '\r\n'.join(headers) + '\r\n\r\n' + body

    def test_upstreams_use_current_bridge_addresses_and_container_ports(self):
        self.assertEqual(self.upstreams['tournaments-api'], '172.25.0.3:8000')
        rendered = nginx(self.identity, self.upstreams)
        self.assertIn('proxy_pass http://172.25.0.3:8000/api/;', rendered)
        self.assertIn('proxy_pass http://172.25.0.2:8000/api/link/;', rendered)
        self.assertIn('proxy_pass http://172.25.0.4:80;', rendered)
        self.assertIn('proxy_pass http://172.25.0.5:80;', rendered)
        self.assertIn('proxy_pass http://172.25.0.6:80;', rendered)
        self.assertNotIn('127.0.0.1:180', rendered)
        self.assertIn('location /tournaments-ws/', rendered)
        self.assertIn('proxy_pass http://172.25.0.3:8000/ws/;', rendered)
        self.assertIn('proxy_set_header Upgrade $http_upgrade;', rendered)
        self.assertIn('proxy_set_header X-Forwarded-Proto $scheme;', rendered)

    def test_addresses_outside_bridge_and_config_injection_are_rejected(self):
        for address in ('172.26.0.2', '127.0.0.1', '0.0.0.0', '::1', '172.25.0.2; return 200'):
            addresses = dict(self.addresses, **{'game-api': address})
            with self.subTest(address=address), self.assertRaises(ValueError):
                upstreams_for_addresses(addresses, ['172.25.0.0/24'])
        changed = dict(self.upstreams, **{'game-api': '172.25.0.2:8000; return 200'})
        with self.assertRaises(ValueError):
            nginx(self.identity, changed)

    def test_missing_or_duplicate_container_addresses_are_rejected(self):
        missing = dict(self.addresses)
        del missing['game-api']
        duplicate = dict(self.addresses, **{'game-api': self.addresses['tournaments-api']})
        for addresses in (missing, duplicate):
            with self.subTest(addresses=addresses), self.assertRaises(ValueError):
                upstreams_for_addresses(addresses, ['172.25.0.0/24'])

    def test_prepare_preview_has_no_unresolved_proxy_routes(self):
        rendered = nginx(self.identity)
        self.assertIn('location = /__e2e__/identity', rendered)
        self.assertNotIn('proxy_pass', rendered)

    def test_health_must_be_real_successful_api_json(self):
        for path in ('/backgammon/api/health/', '/tournaments-api/health/'):
            validate_listener_response(path, self.response({'status': 'ok'}), self.identity)
            for response in (self.response({'status': 'degraded'}), self.response({'status': 'ok'}, status=502),
                             self.response('<script></script>', content_type='text/html')):
                with self.subTest(path=path, response=response), self.assertRaises(ValueError):
                    validate_listener_response(path, response, self.identity)

    def test_csrf_requires_successful_endpoint_and_cookie(self):
        path = '/tournaments-api/csrf/'
        payload = {'detail': 'CSRF cookie set'}
        validate_listener_response(path, self.response(payload, cookie=True), self.identity)
        for response in (self.response(payload), self.response(payload, cookie=True, status=502),
                         self.response({'status': 'ok'}, cookie=True)):
            with self.subTest(response=response), self.assertRaises(ValueError):
                validate_listener_response(path, response, self.identity)

    def test_identity_from_another_session_is_rejected(self):
        path = '/__e2e__/identity'
        validate_listener_response(path, self.response(self.identity), self.identity)
        changed = dict(self.identity, session_id='b' * 32)
        with self.assertRaises(ValueError):
            validate_listener_response(path, self.response(changed), self.identity)

    def test_frontend_requires_successful_application_html(self):
        for path in ('/backgammon/', '/tournaments/', '/tournaments-admin/'):
            validate_listener_response(path, self.response('<html><script src="app.js"></script></html>',
                                       content_type='text/html'), self.identity)
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_listener_response(path, self.response('<html>Error</html>',
                                           content_type='text/html'), self.identity)


if __name__ == '__main__':
    unittest.main()
