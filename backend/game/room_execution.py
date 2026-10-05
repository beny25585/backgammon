"""Bounded, thread-sensitive database contexts and per-room action ordering."""
import asyncio
import contextvars
import logging
import re
import uuid
import weakref
from contextlib import asynccontextmanager
from functools import wraps

from asgiref.sync import ThreadSensitiveContext
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)
_room_locks = weakref.WeakKeyDictionary()
_held_room = contextvars.ContextVar('game_held_room', default=None)
_game_path = re.compile(r'^/ws/game/([^/]+)/?$')


def room_key(room_id):
    try:
        return str(uuid.UUID(str(room_id)))
    except ValueError:
        return str(room_id)


@asynccontextmanager
async def room_operation(room_id):
    """Serialize read/compute/write across both seats, including nested calls."""
    key = room_key(room_id)
    task = asyncio.current_task()
    if _held_room.get() == (key, task):
        yield
        return
    locks = _room_locks.setdefault(asyncio.get_running_loop(), weakref.WeakValueDictionary())
    lock = locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        locks[key] = lock
    async with lock:
        token = _held_room.set((key, task))
        try:
            yield
        finally:
            _held_room.reset(token)


def serialized_room_operation(function):
    @wraps(function)
    async def call(self, *args, **kwargs):
        async with room_operation(self.room_id):
            return await function(self, *args, **kwargs)
    return call


class _DatabaseContext:
    """Keep one public asgiref context alive across all sockets in a bucket."""
    def __init__(self):
        loop = asyncio.get_running_loop()
        self.ready = loop.create_future()
        self.stop = asyncio.Event()
        # Do not inherit an HTTP request's or another bucket's executor context.
        self.owner = contextvars.Context().run(asyncio.create_task, self._hold())

    async def _hold(self):
        async with ThreadSensitiveContext():
            self.ready.set_result(contextvars.copy_context())
            await self.stop.wait()

    async def run(self, application, scope, receive, send):
        context = await asyncio.shield(self.ready)
        task = context.copy().run(asyncio.create_task, application(scope, receive, send))
        return await task

    async def close(self):
        self.stop.set()
        await self.owner


class RoomDatabaseMiddleware:
    """Route a room's ORM work to one of a fixed number of single-thread pools.

    Applies before authentication so setup, Channels connection cleanup and
    consumer timers use the same context. No Django connection crosses threads.
    The contexts live for the process, rather than opening a pool per player.
    SQLite retains the existing shared executor. Room locks are process-local;
    PostgreSQL transactions remain responsible for cross-process fencing.
    """
    def __init__(self, application, *, workers=None):
        self.application = application
        engine = settings.DATABASES['default']['ENGINE']
        configured = getattr(settings, 'GAME_WS_DB_WORKERS', 4) if workers is None else workers
        if type(configured) is not int or not 1 <= configured <= 16:
            raise ImproperlyConfigured('GAME_WS_DB_WORKERS must be an integer between 1 and 16')
        self.workers = configured if engine.endswith('postgresql') else 1
        self._buckets = weakref.WeakKeyDictionary()

    async def __call__(self, scope, receive, send):
        match = _game_path.fullmatch(scope.get('path', ''))
        try:
            identifier = uuid.UUID(match[1]) if match else None
        except ValueError:
            identifier = None
        if self.workers == 1 or identifier is None or scope.get('type') != 'websocket':
            return await self.application(scope, receive, send)
        loop = asyncio.get_running_loop()
        buckets = self._buckets.get(loop)
        if buckets is None:
            buckets = [None] * self.workers
            self._buckets[loop] = buckets
            logger.info('GAME_WS_DB_EXECUTORS workers=%s backend=postgresql', self.workers)
        bucket = identifier.int % self.workers
        if buckets[bucket] is None:
            buckets[bucket] = _DatabaseContext()
        return await buckets[bucket].run(self.application, scope, receive, send)

    async def aclose(self):
        """Release contexts after applications/timers finish (isolated test hosts)."""
        buckets = self._buckets.pop(asyncio.get_running_loop(), [])
        await asyncio.gather(*(bucket.close() for bucket in buckets if bucket is not None))
