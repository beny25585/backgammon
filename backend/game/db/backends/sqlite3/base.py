"""Writer admission for SQLite on the project's Django 4.2 runtime."""
import logging
from time import monotonic

from django.db import OperationalError
from django.db.backends.sqlite3.base import DatabaseWrapper as SQLiteDatabaseWrapper


logger = logging.getLogger(__name__)


class DatabaseWrapper(SQLiteDatabaseWrapper):
    def _start_transaction_under_autocommit(self):
        # SQLite ignores select_for_update(). Deferred reads can therefore fail
        # immediately when upgrading to a writer, despite busy_timeout. Reserve
        # the writer first; Django still owns rollback, commit and savepoints.
        self._observe('begin_immediate', lambda: self.cursor().execute('BEGIN IMMEDIATE'))
        self._writer_started = monotonic()

    def _commit(self):
        result = self._observe('commit', super()._commit)
        self._report_writer_end('commit')
        return result

    def _rollback(self):
        try:
            return self._observe('rollback', super()._rollback)
        finally:
            self._report_writer_end('rollback')

    def _report_writer_end(self, operation):
        started = getattr(self, '_writer_started', None)
        self._writer_started = None
        if started is not None and (duration_ms := (monotonic() - started) * 1000) >= 1000:
            logger.warning(
                'event=sqlite_writer_held alias=%s operation=%s duration_ms=%.1f',
                self.alias, operation, duration_ms,
            )

    def _observe(self, operation, callback):
        started = monotonic()
        try:
            return callback()
        except OperationalError as error:
            if 'locked' in str(error).lower():
                logger.error(
                    'event=sqlite_transaction_locked alias=%s operation=%s wait_ms=%.1f timeout_seconds=%s',
                    self.alias, operation, (monotonic() - started) * 1000,
                    self.settings_dict.get('OPTIONS', {}).get('timeout', 5),
                    exc_info=True,
                )
            raise
