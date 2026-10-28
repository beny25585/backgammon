"""A receive-only view of tournament play, separate from player lifecycle."""

import asyncio
import json
import time
import uuid

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .spectators import (
    LEASE_SECONDS, SpectatorError, SpectatorLeases, public_state,
    renew_spectator_ticket, spectator_revision, spectator_snapshot, verify_spectator_ticket,
)


class SpectatorConsumer(AsyncWebsocketConsumer):
    AUTH_SECONDS = 10
    RECONCILE_SECONDS = 60
    CLOSE_CODES = {'forbidden': 4403, 'expired': 4401, 'full': 4429,
                   'unavailable': 4503, 'ended': 4404}
    GROUP_EVENTS = {
        'game_message', 'game_ended', 'admin_match_ended', 'admin_score_updated',
        'room_cancelled', 'room_expired', 'spectator_auth_timeout',
        'spectator_lease_timeout',
    }

    async def dispatch(self, message):
        # The player group also carries presence and private rematch messages.
        # Never run a player handler or forward those events to spectators.
        kind = message.get('type', '')
        if kind.startswith('websocket.') or kind in self.GROUP_EVENTS:
            await super().dispatch(message)

    async def connect(self):
        self.closed = False
        self.authenticated = False
        self.leases = None
        self.joined = False
        self.last_version = -1
        self.lease_generation = 0
        self.last_ping = 0
        self.last_reconcile = time.monotonic()
        self.auth_task = None
        self.lease_task = None
        self.claims = None
        try:
            self.room_id = str(uuid.UUID(str(self.scope['url_route']['kwargs']['room_id'])))
        except (KeyError, ValueError, TypeError):
            await self.close(code=4403)
            return
        self.room_group_name = f'game_{self.room_id}'
        await self.accept()
        self.auth_task = asyncio.create_task(self._timer(
            self.AUTH_SECONDS, {'type': 'spectator_auth_timeout'}))

    async def _timer(self, seconds, event):
        await asyncio.sleep(seconds)
        await self.channel_layer.send(self.channel_name, event)

    def _arm_lease_timeout(self):
        if self.lease_task:
            self.lease_task.cancel()
        self.lease_generation += 1
        self.lease_task = asyncio.create_task(self._timer(
            LEASE_SECONDS, {'type': 'spectator_lease_timeout',
                            'generation': self.lease_generation}))

    async def receive(self, text_data=None, bytes_data=None):
        if self.closed:
            return
        if not text_data or len(text_data) > 4096:
            await self._fail('forbidden')
            return
        try:
            data = json.loads(text_data)
        except (TypeError, ValueError):
            await self._fail('forbidden')
            return
        if not isinstance(data, dict):
            await self._fail('forbidden')
            return
        if not self.authenticated:
            if data.get('type') != 'spectator_auth':
                await self._fail('forbidden')
                return
            await self._authenticate(data.get('ticket'))
        elif data.get('type') == 'spectator_ping':
            await self._ping()
        else:
            # Move/roll/leave/give_up and any future player messages are refused.
            await self._fail('forbidden')

    async def _authenticate(self, ticket):
        try:
            self.claims = verify_spectator_ticket(ticket, self.room_id)
            self.leases = SpectatorLeases(self.room_id, str(uuid.uuid4()))
            if not await self.leases.apply('reserve'):
                raise SpectatorError('full')
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            self.joined = True
            # Subscribe before reading: queued older events are discarded by
            # version after this coherent persisted snapshot has been sent.
            snapshot = await database_sync_to_async(spectator_snapshot)(self.claims)
            if snapshot['status'] != 'playing':
                raise SpectatorError('ended' if snapshot['status'] in
                                     ('completed', 'cancelled') else 'unavailable')
            if not await self.leases.apply('valid'):
                raise SpectatorError('expired')
            self.authenticated = True
            self.meta = snapshot['meta']
            self.status = snapshot['status']
            self.last_version = snapshot['payload'].get('version', -1)
            if self.auth_task:
                self.auth_task.cancel()
            self._arm_lease_timeout()
            await self._send({'type': 'spectator_state', 'payload': snapshot['payload'],
                              'meta': self.meta,
                              'ticket': renew_spectator_ticket(self.claims)})
        except SpectatorError as exc:
            await self._fail(exc.code)
        except Exception:
            await self._fail('unavailable')

    async def _valid_lease(self):
        if self.closed or not self.authenticated:
            return False
        try:
            if not await self.leases.apply('valid'):
                await self._fail('expired')
                return False
            return True
        except Exception:
            await self._fail('unavailable')
            return False

    async def _ping(self):
        # Bound renewal/signing work if a client ignores the 15-second cadence.
        now = time.monotonic()
        if now - self.last_ping < 5:
            return
        self.last_ping = now
        try:
            if not await self.leases.apply('renew'):
                await self._fail('expired')
                return
            self._arm_lease_timeout()
            # Groups deliver at most once. Recover a lost final event or board
            # update with one small read per minute, never a query per move.
            if now - self.last_reconcile >= self.RECONCILE_SECONDS:
                self.last_reconcile = now
                revision = await database_sync_to_async(spectator_revision)(self.room_id)
                score = self.meta['matchScore']
                if (revision['status'] != self.status
                        or revision['last_sequence'] != self.last_version
                        or revision['white_score'] != score['white']
                        or revision['black_score'] != score['black']):
                    await self._refresh_snapshot()
                    if self.closed:
                        return
            ticket = renew_spectator_ticket(self.claims)
            await self._send({'type': 'spectator_pong', 'ticket': ticket})
        except Exception:
            await self._fail('unavailable')

    async def game_message(self, event):
        if event.get('event_type') != 'state_update' or not await self._valid_lease():
            return
        payload = public_state(event.get('payload'))
        version = payload.get('version')
        if type(version) is not int or version <= self.last_version:
            return
        self.last_version = version
        await self._send({'type': 'spectator_state', 'payload': payload, 'meta': self.meta})

    async def _refresh_snapshot(self, *, terminal=False):
        if not await self._valid_lease():
            return
        try:
            snapshot = await database_sync_to_async(spectator_snapshot)(self.claims)
            if not await self._valid_lease():
                return
            ended = terminal or snapshot['status'] in ('completed', 'cancelled')
            if snapshot['payload'].get('version', -1) < self.last_version:
                # A delayed database read must not restore an older board.
                # Committed terminal events have their own newer sequence.
                return
            self.meta = snapshot['meta']
            self.status = snapshot['status']
            self.last_version = snapshot['payload'].get('version', -1)
            await self._send({'type': 'spectator_end' if ended else 'spectator_state',
                              'payload': snapshot['payload'], 'meta': self.meta})
            if ended:
                await self._stop(1000)
        except SpectatorError as exc:
            await self._fail(exc.code)
        except Exception:
            await self._fail('unavailable')

    async def game_ended(self, event):
        # A match can contain many games. The persisted room status, rather
        # than a client-controlled signal, decides whether viewing finishes.
        await self._refresh_snapshot()

    async def admin_match_ended(self, event):
        await self._refresh_snapshot(terminal=True)

    async def admin_score_updated(self, event):
        await self._refresh_snapshot()

    async def room_cancelled(self, event):
        await self._refresh_snapshot(terminal=True)

    async def room_expired(self, event):
        await self._refresh_snapshot(terminal=True)

    async def spectator_auth_timeout(self, event):
        if not self.authenticated and not self.closed:
            await self._fail('expired')

    async def spectator_lease_timeout(self, event):
        if event.get('generation') == self.lease_generation and not self.closed:
            await self._fail('expired')

    async def _send(self, message):
        if not self.closed:
            await self.send(text_data=json.dumps(message))

    async def _fail(self, code):
        if not self.closed:
            await self._send({'type': 'spectator_error', 'code': code})
            await self._stop(self.CLOSE_CODES[code])

    async def _cleanup(self):
        for task in (self.auth_task, self.lease_task):
            if task:
                task.cancel()
        if self.joined:
            self.joined = False
            try:
                await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            except Exception:
                pass
        if self.leases:
            leases, self.leases = self.leases, None
            try:
                await leases.apply('release')
            except Exception:
                # The short lease still releases the slot after worker/network loss.
                pass
            finally:
                try:
                    await leases.close()
                except Exception:
                    pass

    async def _stop(self, code):
        self.closed = True
        await self._cleanup()
        await self.close(code=code)

    async def disconnect(self, close_code):
        self.closed = True
        await self._cleanup()
