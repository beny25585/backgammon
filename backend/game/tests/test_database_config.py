from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from backgammon_project.database import postgresql_database


class PostgreSQLConfigurationTests(SimpleTestCase):
    def test_database_url_is_required_without_any_file_database_fallback(self):
        for value in ('', None, '   '):
            with self.subTest(value=value), self.assertRaisesMessage(ImproperlyConfigured, 'DATABASE_URL is required'):
                postgresql_database(value)

    def test_postgresql_database_preserves_explicit_credentials_host_port_and_options(self):
        database = postgresql_database('postgresql://game:encoded%40password@127.0.0.1:55432/game_test?sslmode=require')
        self.assertEqual(database['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(database['NAME'], 'game_test')
        self.assertEqual(database['PASSWORD'], 'encoded@password')
        self.assertEqual(str(database['PORT']), '55432')
        self.assertEqual(database['OPTIONS'], {'sslmode': 'require', 'connect_timeout': 5})

    def test_other_backends_are_refused_before_the_url_parser_can_load_them(self):
        with patch('backgammon_project.database.dj_database_url.parse') as parser:
            for value in ('sqlite:///ignored.sqlite3', 'mysql://user:private-test-password@localhost/db'):
                with self.subTest(scheme=value.split(':', 1)[0]), self.assertRaises(ImproperlyConfigured) as raised:
                    postgresql_database(value)
                self.assertNotIn('private-test-password', str(raised.exception))
        parser.assert_not_called()

    def test_malformed_postgresql_url_does_not_expose_credentials(self):
        with self.assertRaises(ImproperlyConfigured) as raised:
            postgresql_database('postgresql://game:private-test-password@127.0.0.1:bad/game_test')
        self.assertNotIn('private-test-password', str(raised.exception))
