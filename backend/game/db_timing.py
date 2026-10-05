"""Measure sync executor admission separately from database execution."""
import logging
from functools import wraps
from time import perf_counter

from channels.db import database_sync_to_async
from django.db import connection

logger = logging.getLogger(__name__)


def measured_database_sync_to_async(function):
    @wraps(function)
    async def call(*args, **kwargs):
        queued = perf_counter()
        metrics = {'sql_ms': 0.0, 'sql_count': 0}

        def execute():
            started = perf_counter()
            metrics['queue_ms'] = (started - queued) * 1000

            def observe(sql_execute, sql, params, many, context):
                sql_started = perf_counter()
                try:
                    return sql_execute(sql, params, many, context)
                finally:
                    metrics['sql_ms'] += (perf_counter() - sql_started) * 1000
                    metrics['sql_count'] += 1

            try:
                with connection.execute_wrapper(observe):
                    return function(*args, **kwargs)
            finally:
                metrics['execution_ms'] = (perf_counter() - started) * 1000

        try:
            return await database_sync_to_async(execute)()
        finally:
            total = (perf_counter() - queued) * 1000
            if total >= 250:
                logger.warning(
                    'event=db_call_slow operation=%s total_ms=%.1f queue_ms=%.1f '
                    'execution_ms=%.1f sql_ms=%.1f sql_count=%s',
                    function.__name__, total, metrics.get('queue_ms', 0),
                    metrics.get('execution_ms', 0), metrics['sql_ms'], metrics['sql_count'],
                )

    return call
