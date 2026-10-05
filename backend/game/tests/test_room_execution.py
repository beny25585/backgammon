import asyncio
import threading
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from asgiref.sync import ThreadSensitiveContext, sync_to_async
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from game.room_execution import RoomDatabaseMiddleware, room_operation, serialized_room_operation


class RoomDatabaseContextTests(IsolatedAsyncioTestCase):
    def middleware(self, application, *, engine='django.db.backends.postgresql', workers=4):
        configuration = SimpleNamespace(DATABASES={'default': {'ENGINE': engine}})
        with patch('game.room_execution.settings', configuration):
            middleware = RoomDatabaseMiddleware(application, workers=workers)
        self.addAsyncCleanup(middleware.aclose)
        return middleware

    async def invoke(self, middleware, room=1, **scope):
        return await middleware({'type': 'websocket', 'path': f'/ws/game/{uuid.UUID(int=room)}/',
                                 **scope}, AsyncMock(), AsyncMock())

    async def test_many_sockets_use_only_the_configured_worker_threads(self):
        async def application(*args):
            return await sync_to_async(threading.get_ident)()
        middleware = self.middleware(application)
        threads = await asyncio.gather(*(self.invoke(middleware, room) for room in range(1, 33)))
        self.assertEqual(len(set(threads)), 4)
        for index in range(4):
            self.assertEqual(len(set(threads[index::4])), 1)
        self.assertEqual(await self.invoke(middleware, 1), threads[0])

    async def test_other_room_bucket_continues_while_one_database_thread_is_busy(self):
        started = asyncio.Event()
        release = threading.Event()
        loop = asyncio.get_running_loop()

        def blocked():
            loop.call_soon_threadsafe(started.set)
            if not release.wait(3):
                raise AssertionError('blocked worker was not released')

        async def application(scope, *args):
            if scope['path'].endswith(f'{uuid.UUID(int=1)}/'):
                await sync_to_async(blocked)()
            return await sync_to_async(threading.get_ident)()

        middleware = self.middleware(application, workers=2)
        first = asyncio.create_task(self.invoke(middleware, 1))
        try:
            await asyncio.wait_for(started.wait(), 2)
            other = await asyncio.wait_for(self.invoke(middleware, 2), 2)
            self.assertFalse(first.done())
        finally:
            release.set()
            first_thread = await first
        self.assertNotEqual(first_thread, other)

    async def test_both_seats_and_timer_tasks_keep_the_same_room_thread(self):
        async def application(*args):
            first = await sync_to_async(threading.get_ident)()
            async def timer():
                return await sync_to_async(threading.get_ident)()
            return first, await asyncio.create_task(timer())
        middleware = self.middleware(application)
        white, black = await asyncio.gather(self.invoke(middleware, 5), self.invoke(middleware, 5))
        self.assertEqual(white, black)
        self.assertEqual(white[0], white[1])

    async def test_existing_outer_context_does_not_merge_room_buckets(self):
        async def application(*args):
            return await sync_to_async(threading.get_ident)()
        middleware = self.middleware(application, workers=2)
        async with ThreadSensitiveContext():
            parent = await sync_to_async(threading.get_ident)()
            one, two = await asyncio.gather(self.invoke(middleware, 1), self.invoke(middleware, 2))
        self.assertEqual(len({parent, one, two}), 3)

    async def test_sqlite_keeps_the_existing_shared_executor(self):
        application = AsyncMock(return_value='unchanged')
        middleware = self.middleware(application, engine='game.db.backends.sqlite3')
        self.assertEqual(middleware.workers, 1)
        self.assertEqual(await self.invoke(middleware), 'unchanged')
        self.assertFalse(middleware._buckets)

    async def test_http_and_invalid_room_paths_do_not_create_pools(self):
        middleware = self.middleware(AsyncMock())
        await self.invoke(middleware, type='http')
        await self.invoke(middleware, path='/ws/game/not-a-room/')
        await self.invoke(middleware, path='/ws/other/')
        self.assertFalse(middleware._buckets)

    async def test_invalid_worker_counts_fail_configuration(self):
        for value in (0, 17, True, '4'):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                self.middleware(AsyncMock(), workers=value)


class RoomOperationTests(SimpleTestCase):
    async def test_second_seat_reads_the_state_only_after_first_seat_commits(self):
        first_read = asyncio.Event()
        second_started = asyncio.Event()
        release = asyncio.Event()
        stored = {'version': 0}
        seen = []

        async def first():
            async with room_operation('same-room'):
                seen.append(stored['version'])
                first_read.set()
                await release.wait()
                stored['version'] += 1

        async def second():
            second_started.set()
            async with room_operation('same-room'):
                seen.append(stored['version'])
                stored['version'] += 1

        one = asyncio.create_task(first())
        await first_read.wait()
        two = asyncio.create_task(second())
        await second_started.wait()
        self.assertEqual(seen, [0])
        release.set()
        await asyncio.wait_for(asyncio.gather(one, two), 2)
        self.assertEqual(seen, [0, 1])
        self.assertEqual(stored['version'], 2)

    async def test_nested_consumer_calls_do_not_deadlock(self):
        class Consumer:
            room_id = str(uuid.uuid4())

            @serialized_room_operation
            async def receive(self):
                return await self.intent()

            @serialized_room_operation
            async def intent(self):
                return 'saved'

        self.assertEqual(await asyncio.wait_for(Consumer().receive(), 2), 'saved')

    async def test_child_task_does_not_inherit_permission_to_skip_the_lock(self):
        entered = asyncio.Event()
        async def child():
            async with room_operation('room'):
                entered.set()
        async with room_operation('room'):
            task = asyncio.create_task(child())
            await asyncio.sleep(0)
            self.assertFalse(entered.is_set())
        await asyncio.wait_for(task, 2)
        self.assertTrue(entered.is_set())

    async def test_other_room_can_proceed_and_canceled_waiter_does_not_hold_lock(self):
        async with room_operation('room'):
            async def waiting():
                async with room_operation('room'):
                    self.fail('canceled waiter must not enter')
            task = asyncio.create_task(waiting())
            await asyncio.sleep(0)
            async with room_operation('another-room'):
                task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        async with room_operation('room'):
            pass
