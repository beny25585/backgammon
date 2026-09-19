"""Practice rooms reuse the online protocol and scoring, with a server bot."""
import asyncio
import copy
import json
import logging

from channels.db import database_sync_to_async
from django.utils import timezone

from . import ai
from .consumers import GameConsumer, get_room, get_game_state, run_in_background
from .models import AiSession

logger = logging.getLogger(__name__)


class PracticeGameConsumer(GameConsumer):
    async def connect(self):
        self.is_ai = False
        self._ai_task = None
        self._ai_failed = False
        self._ai_disconnected = False
        room = await get_room(self.scope['url_route']['kwargs']['room_id'])
        self.is_ai = bool(room and (room.state or {}).get('ai'))
        if self.is_ai and room.status == 'waiting':
            await self.close(code=4003)
            return
        await super().connect()
        if self.is_ai and getattr(self, 'player_color', None):
            await self.send(json.dumps({'type': 'player_joined', 'payload': {
                'playerColor': 'black', 'username': 'Open Sage'}}))
            self._kick_bot()

    async def receive(self, text_data):
        if not self.is_ai:
            return await super().receive(text_data)
        try:
            data = json.loads(text_data)
        except (ValueError, TypeError):
            return await self._send_error('Invalid message')
        if not isinstance(data, dict) or data.get('type') not in ('state_update', 'give_up', 'leave', 'ai_retry'):
            return await self._send_error('Action unavailable in practice')
        lease = await database_sync_to_async(ai.claim)(self.room_id)
        # State broadcasts can reach the browser just before the bot releases
        # its lease. Queue that human intent briefly instead of losing a roll.
        for _ in range(150):
            if lease:
                break
            await asyncio.sleep(0.1)
            lease = await database_sync_to_async(ai.claim)(self.room_id)
        if not lease:
            return await self._send_error('The computer is finishing its turn. Please try again.')
        try:
            room = await get_room(self.room_id)
            if room.status != 'playing':
                return await self._send_error('This practice game has ended')
            self._ai_failed = False
            if data.get('type') != 'ai_retry':
                await super().receive(text_data)
            else:
                await self.send(json.dumps({'type': 'ai_status', 'payload': {'status': 'thinking'}}))
        finally:
            await database_sync_to_async(ai.release)(self.room_id, lease)
        self._kick_bot()

    async def _arm_opening_result_watch(self):
        if self.is_ai:
            self._kick_bot()
        else:
            await super()._arm_opening_result_watch()

    async def _broadcast_room_status(self):
        if not self.is_ai:
            return await super()._broadcast_room_status()
        await self.channel_layer.group_send(self.room_group_name, {
            'type': 'room_status', 'connected': 2, 'connectedColors': ['white', 'black']})

    async def game_message(self, event):
        await super().game_message(event)
        if self.is_ai:
            self._kick_bot()

    async def ai_status(self, event):
        await self.send(json.dumps({'type': 'ai_status', 'payload': event['payload']}))

    async def disconnect(self, close_code):
        self._ai_disconnected = True
        if not hasattr(self, 'room_group_name'):
            return
        # Let an already-started authoritative turn finish; reconnect loads it.
        await super().disconnect(close_code)

    async def _presence_heartbeat(self):
        if not self.is_ai:
            return await super()._presence_heartbeat()
        while True:
            await asyncio.sleep(10)
            self._kick_bot()

    def _kick_bot(self):
        if self._ai_disconnected or self._ai_failed or (self._ai_task and not self._ai_task.done()):
            return
        self._ai_task = run_in_background(self._play_bot())

    async def _play_bot(self):
        lease = await database_sync_to_async(ai.claim)(self.room_id)
        if not lease:
            return
        try:
            # Separate actor: never change the authenticated human's color.
            actor = copy.copy(self)
            actor.player_color = 'black'
            async def reject(message, action=None):
                raise RuntimeError(f'AI intent rejected: {message}')
            actor._send_error = reject
            for _ in range(12):
                room = await get_room(self.room_id)
                if not room or room.status != 'playing':
                    return
                state = (await get_game_state(room)).state_data
                match = {'target_points': room.target_points,
                         'scores': {'white': room.white_score, 'black': room.black_score}}
                if state['phase'] == 'doubling_offered':
                    if state.get('doubleOfferedBy') != 'white':
                        return
                    decision = await ai.request_decision(state, 'hard', match, 'cube')
                    if type(decision.get('should_take')) is not bool:
                        raise ValueError('Invalid cube response')
                    await GameConsumer._handle_intent(actor, {'action': 'double_response', 'accept': decision['should_take']})
                    continue
                if state['phase'] == 'opening_result':
                    await GameConsumer._opening_result_watch(actor)
                    continue
                if state['turn'] != 'black' or state['phase'] == 'game_over':
                    return
                if state['phase'] in ('opening_roll', 'rolling'):
                    await database_sync_to_async(AiSession.objects.filter(room_id=self.room_id).update)(target_board=None)
                    if (state['phase'] == 'rolling' and state.get('doublingEnabled')
                            and state.get('cubeOwner') in ('center', 'black')
                            and state.get('cube', 1) < state.get('maxCube', 64)):
                        decision = await ai.request_decision(state, 'hard', match, 'cube')
                        if decision.get('should_double') is True:
                            await GameConsumer._handle_intent(actor, {'action': 'double'})
                            return
                    intents = [{'action': 'roll'}]
                elif state['phase'] == 'moving' and not state['remaining']:
                    intents = [{'action': 'end_turn'}]
                elif state['phase'] == 'moving':
                    session = await database_sync_to_async(AiSession.objects.get)(room_id=self.room_id)
                    target = session.target_board
                    if target is None:
                        target = await ai.request_board(state, session.difficulty, match)
                        await database_sync_to_async(AiSession.objects.filter(room_id=self.room_id).update)(target_board=target)
                    intents = ai.executable_turn(state, target)
                    if not intents:
                        intents = [{'action': 'end_turn'}]
                else:
                    return
                for intent in intents:
                    owned = await database_sync_to_async(AiSession.objects.filter(
                        room_id=self.room_id, lease_token=lease,
                        lease_until__gt=timezone.now()).exists)()
                    if not owned:
                        raise RuntimeError('AI command lease expired')
                    await GameConsumer._handle_intent(actor, intent)
                    await asyncio.sleep(0.25)
            raise RuntimeError('AI turn did not complete')
        except Exception:
            logger.exception('Practice bot failed for room %s', self.room_id)
            self._ai_failed = True
            await self.channel_layer.group_send(self.room_group_name, {
                'type': 'game_message', 'event_type': 'error', 'playerColor': None,
                'payload': {'message': 'Open Sage is unavailable. Please retry.', 'action': 'ai_retry'}})
        finally:
            await database_sync_to_async(ai.release)(self.room_id, lease)
            if not self._ai_failed:
                await self.channel_layer.group_send(self.room_group_name, {
                    'type': 'ai_status', 'payload': {'status': 'ready'}})
