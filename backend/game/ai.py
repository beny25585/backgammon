"""Open Sage transport and validation against our authoritative game rules.

Upstream board contract: markbgsage/bgsage python/bgsage/board.py and
types.py, revision d8325a491168062df1047ffd998f3a5dfb426a0c.
The engine ranks final boards; this adapter reconstructs executable intents.
"""
import copy
import uuid
from datetime import timedelta

import httpx
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .engine import BackgammonEngine
from .models import AiSession


def claim(room_id):
    now = timezone.now()
    token = str(uuid.uuid4())
    updated = AiSession.objects.filter(room_id=room_id).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lt=now)
    ).update(lease_token=token, lease_until=now + timedelta(seconds=60))
    return token if updated else None


def release(room_id, token):
    AiSession.objects.filter(room_id=room_id, lease_token=token).update(lease_until=None, lease_token='')


def native_board(state, color):
    points = state['points'] if color == 'white' else [-p for p in reversed(state['points'])]
    other = 'black' if color == 'white' else 'white'
    return [state['bar'][other], *points, state['bar'][color]]


def executable_turn(state, target):
    """Find a full legal turn reaching Sage's final board, including dice order.

Never apply the remote board directly. Every emitted move is checked through
make_move; all dice-use obligations remain with BackgammonEngine.
"""
    if not isinstance(target, list) or len(target) != 26 or any(type(p) is not int for p in target):
        raise ValueError('Invalid Open Sage board')
    color = state['turn']
    seen = set()

    def search(current, depth=0):
        key = (tuple(current['points']), tuple(current['remaining']),
               tuple(current['bar'].values()), tuple(current['home'].values()), current['turn'], current['phase'])
        if key in seen:
            return None
        seen.add(key)
        if len(seen) > 50000:
            raise ValueError('Move reconstruction exceeded its limit')
        engine = BackgammonEngine(current)
        finished = current['turn'] != color or current['phase'] != 'moving' or not current['remaining']
        if finished:
            return [] if native_board(current, color) == target else None
        if depth >= 4:
            return None
        for move in engine.all_legal_moves(color):
            next_engine = BackgammonEngine(copy.deepcopy(current))
            prefix = []
            same = [m for m in next_engine.legal_moves_from(move['from'], color) if m['to'] == move['to']]
            if same[0]['die'] != move['die']:
                next_engine.reorder_dice(color)
                prefix.append({'action': 'reorder_dice'})
            result = next_engine.make_move(move['from'], move['to'], color)
            if not result['success']:
                continue
            rest = search(next_engine.state, depth + 1)
            if rest is not None:
                return prefix + [{'action': 'move', 'from': move['from'], 'to': move['to']}] + rest
        return None

    result = search(copy.deepcopy(state))
    if result is None:
        raise ValueError('Open Sage result is not a legal complete turn')
    return result


async def request_decision(state, difficulty, match=None, action='move'):
    base = getattr(settings, 'AI_SERVICE_URL', '').rstrip('/')
    token = getattr(settings, 'ANALYSIS_API_TOKEN', '')
    if not base or not token:
        raise RuntimeError('Open Sage service is not configured')
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.post(base + '/api/v1/internal/bot/move/',
            headers={'Authorization': f'Bearer {token}'},
            json={'state': state, 'difficulty': difficulty, 'match': match or {}, 'action': action})
        response.raise_for_status()
    return response.json()


async def request_board(state, difficulty, match=None):
    target = (await request_decision(state, difficulty, match)).get('board')
    executable_turn(state, target)
    return target
