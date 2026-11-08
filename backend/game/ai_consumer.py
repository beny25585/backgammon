"""Practice rooms reuse the online protocol and scoring, with a server bot."""
import asyncio
import copy
import json
import logging
import random

import httpx
from channels.db import database_sync_to_async
from django.db import OperationalError

from . import ai
from .consumers import GameConsumer, get_game_state, get_room, run_in_background
from .dice import DiceServiceError
from .engine import BackgammonEngine
from .models import AiSession

logger = logging.getLogger(__name__)
BOT_RETRY_DELAYS = (0.5, 2.0)


def _retryable_bot_failure(error):
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        return status == 408 or status >= 500
    return isinstance(error, (httpx.TransportError, DiceServiceError, OperationalError, ai.BotStateChanged))


class PracticeGameConsumer(GameConsumer):
    async def connect(self):
        self.is_ai = False
        self._ai_task = None
        self._ai_recheck = False
        self._ai_failed = False
        self._ai_disconnected = False
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
        if isinstance(data, dict) and data.get('type') == 'player_reaction':
            return await super().receive(text_data)
        if not isinstance(data, dict) or data.get('type') not in ('state_update', 'give_up', 'leave', 'ai_retry'):
            return await self._send_error('Action unavailable in practice')
        lease = await database_sync_to_async(ai.claim)(self.room_id)
        # Keep existing behavior for actions submitted while the bot owns
        # the room, such as leaving before its turn ends.
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
                state = (await get_game_state(room)).state_data
                has_bot_turn = ai.bot_should_act(state)
                await self.send(json.dumps({'type': 'ai_status', 'payload': {
                    'status': 'thinking' if has_bot_turn else 'ready',
                }}))
                if not has_bot_turn:
                    return
        finally:
            await database_sync_to_async(ai.release)(self.room_id, lease)
        self._kick_bot(recheck=data.get('type') == 'ai_retry')

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
        if (self.is_ai and event.get('event_type') == 'state_update'
                and ai.bot_should_act(event.get('payload') or {})):
            self._kick_bot(recheck=event.get('playerColor') == 'white')

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

    def _kick_bot(self, *, recheck=False):
        if self._ai_disconnected or self._ai_failed:
            return
        if self._ai_task and not self._ai_task.done():
            if recheck:
                self._ai_recheck = True
            return
        self._ai_recheck = False
        self._ai_task = run_in_background(self._play_bot())
        self._ai_task.add_done_callback(self._recheck_after_bot)

    def _recheck_after_bot(self, task):
        if self._ai_task is task and self._ai_recheck:
            self._kick_bot()

    async def _play_bot(self):
        for delay in (*BOT_RETRY_DELAYS, None):
            try:
                played = await self._play_bot_attempt()
            except ai.BotLeaseLost:
                return
            except Exception as error:
                if delay is None or not _retryable_bot_failure(error):
                    logger.exception('Practice bot failed for room %s', self.room_id)
                    self._ai_failed = True
                    await self.channel_layer.group_send(self.room_group_name, {
                        'type': 'game_message', 'event_type': 'error', 'playerColor': None,
                        'payload': {'message': 'Open Sage is unavailable. Please retry.', 'action': 'ai_retry'},
                    })
                    return
                logger.warning('Practice bot retry room=%s delay=%s error=%s',
                               self.room_id, delay, type(error).__name__)
                await asyncio.sleep(delay * random.uniform(0.8, 1.2))
            else:
                if played:
                    await self.channel_layer.group_send(self.room_group_name, {
                        'type': 'ai_status', 'payload': {'status': 'ready'},
                    })
                return

    async def _play_bot_attempt(self):
        lease = await database_sync_to_async(ai.claim_bot)(self.room_id)
        if not lease:
            return False
        handed_off = False
        try:
            handed_off = await self._continue_bot_turn(lease)
        finally:
            if not handed_off:
                await database_sync_to_async(ai.release)(self.room_id, lease)
        return True

    async def _continue_bot_turn(self, lease):
        actor = copy.copy(self)
        actor.player_color = 'black'

        async def reject(message, action=None):
            raise RuntimeError(f'AI intent rejected: {message}')

        actor._send_error = reject
        for _ in range(12):
            room = await get_room(self.room_id)
            if not room or room.status != 'playing':
                return False
            state = (await get_game_state(room)).state_data
            if not ai.bot_should_act(state):
                return False
            if state['phase'] == 'opening_result':
                next_state = await GameConsumer._opening_result_watch(actor, bot_lease=lease)
                if next_state is None:
                    return False
                if not ai.bot_should_act(next_state):
                    return True
                continue

            match = {'target_points': room.target_points,
                     'scores': {'white': room.white_score, 'black': room.black_score}}
            if state['phase'] == 'doubling_offered':
                decision = await ai.request_decision(state, 'hard', match, 'cube')
                if type(decision.get('should_take')) is not bool:
                    raise ValueError('Invalid cube response')
                intents = [{'action': 'double_response', 'accept': decision['should_take']}]
            elif state['phase'] in ('opening_roll', 'rolling'):
                await database_sync_to_async(ai.save_bot_target)(self.room_id, lease, None)
                engine = BackgammonEngine(state)
                action = 'roll'
                if (not engine.is_bar_fully_blocked('black') and engine.can_offer_double(
                        'black', target_points=room.target_points, scores=match['scores'])):
                    decision = await ai.request_decision(state, 'hard', match, 'cube')
                    if decision.get('should_double') is True:
                        action = 'double'
                intents = [{'action': action}]
            elif state['remaining']:
                intents = await self._resume_bot_moves(state, match, lease)
            else:
                intents = [{'action': 'end_turn'}]

            version = room.last_sequence
            for intent in intents:
                next_state = await GameConsumer._handle_intent(
                    actor, intent, bot_lease=lease, bot_version=version,
                )
                if next_state is None:
                    return False
                if not ai.bot_should_act(next_state):
                    return True
                version = next_state['version']
                await asyncio.sleep(1.5)
        raise RuntimeError('AI turn did not complete')

    async def _resume_bot_moves(self, state, match, lease):
        session = await database_sync_to_async(AiSession.objects.get)(room_id=self.room_id)
        if session.target_board is not None:
            try:
                intents = ai.executable_turn(state, session.target_board)
            except ValueError:
                await database_sync_to_async(ai.save_bot_target)(self.room_id, lease, None)
            else:
                return intents or [{'action': 'end_turn'}]

        dice = state['dice']
        full_roll = dice * 2 if len(dice) == 2 and dice[0] == dice[1] else dice
        if sorted(state['remaining']) == sorted(full_roll):
            target = await ai.request_board(state, session.difficulty, match)
            intents = ai.executable_turn(state, target)
            await database_sync_to_async(ai.save_bot_target)(self.room_id, lease, target)
            return intents or [{'action': 'end_turn'}]

        # Sage accepts only complete rolls. Recover a partial legacy turn using
        # a legal move from the saved board and remaining dice.
        moves = BackgammonEngine(state).all_legal_moves('black')
        return [{'action': 'move', **moves[0]}] if moves else [{'action': 'end_turn'}]
