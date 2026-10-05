"""File-backed contention checks; never connect to the application's database."""
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
import unittest

from django.db import OperationalError

from game.db.backends.sqlite3.base import DatabaseWrapper


class SQLiteWriteAdmissionTests(unittest.TestCase):
    def connection(self, path, timeout=2):
        return DatabaseWrapper({
            'NAME': str(path), 'ENGINE': 'game.db.backends.sqlite3',
            'OPTIONS': {'timeout': timeout}, 'TIME_ZONE': None,
            'AUTOCOMMIT': True, 'ATOMIC_REQUESTS': False,
            'CONN_MAX_AGE': 0, 'CONN_HEALTH_CHECKS': False,
            'USER': '', 'PASSWORD': '', 'HOST': '', 'PORT': '',
        }, alias='sqlite_write_admission_probe')

    def initialize(self, connection):
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE counter (value INTEGER NOT NULL)')
            cursor.execute('INSERT INTO counter VALUES (0)')

    def begin(self, connection):
        connection.set_autocommit(False, force_begin_transaction_with_broken_autocommit=True)

    def test_second_read_modify_write_waits_and_observes_first_commit(self):
        with TemporaryDirectory(prefix='sqlite-admission-') as directory:
            path = Path(directory) / 'test.sqlite3'
            first = self.connection(path)
            attempted = Event()
            read = Event()
            failures = []
            observed = []

            def second_writer():
                second = self.connection(path)
                try:
                    attempted.set()
                    self.begin(second)
                    with second.cursor() as cursor:
                        value = cursor.execute('SELECT value FROM counter').fetchone()[0]
                        observed.append(value)
                        read.set()
                        cursor.execute('UPDATE counter SET value = %s', [value + 1])
                    second.commit()
                    second.set_autocommit(True)
                except Exception as error:
                    failures.append(error)
                finally:
                    second.close()

            worker = Thread(target=second_writer, daemon=True)
            try:
                self.initialize(first)
                self.begin(first)
                # Reserve before any UPDATE: the second writer must not read a
                # stale snapshot and subsequently fail its SQLite lock upgrade.
                with first.cursor() as cursor:
                    self.assertEqual(cursor.execute('SELECT value FROM counter').fetchone()[0], 0)
                worker.start()
                self.assertTrue(attempted.wait(2), 'Second writer did not start')
                self.assertFalse(read.wait(0.2), 'Second writer read before the first transaction committed')
                with first.cursor() as cursor:
                    cursor.execute('UPDATE counter SET value = 1')
                first.commit()
                first.set_autocommit(True)
                worker.join(4)
                self.assertFalse(worker.is_alive(), 'Second writer did not finish')
                self.assertEqual(failures, [])
                self.assertEqual(observed, [1])
                with first.cursor() as cursor:
                    self.assertEqual(cursor.execute('SELECT value FROM counter').fetchone()[0], 2)
            finally:
                first.close()
                if worker.ident is not None:
                    worker.join(4)

    def test_timeout_is_reported_and_rollback_preserves_original_data(self):
        with TemporaryDirectory(prefix='sqlite-admission-timeout-') as directory:
            path = Path(directory) / 'test.sqlite3'
            first = self.connection(path)
            second = self.connection(path, timeout=0.05)
            try:
                self.initialize(first)
                self.begin(first)
                with first.cursor() as cursor:
                    cursor.execute('UPDATE counter SET value = 9')
                with self.assertLogs('game.db.backends.sqlite3.base', level='ERROR') as captured:
                    with self.assertRaises(OperationalError):
                        self.begin(second)
                self.assertTrue(any('operation=begin_immediate' in line for line in captured.output))
                first.rollback()
                first.set_autocommit(True)
                self.begin(second)
                with second.cursor() as cursor:
                    self.assertEqual(cursor.execute('SELECT value FROM counter').fetchone()[0], 0)
                second.commit()
                second.set_autocommit(True)
            finally:
                second.close()
                first.close()
