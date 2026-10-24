"""Bounded replay reads, independent of financial result delivery."""
import hashlib
import json
import time
import uuid

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from game.models import Match
from .models import TournamentLink
from .signing import verify_command_signature

REPLAY_MAX_BYTES = 48 * 1024
REPLAY_PAGE_TURNS = 50
GAME_SUMMARY_FIELDS = (
    'game_number', 'winner', 'win_type', 'points_awarded', 'final_cube',
    'pips_remaining', 'checkers_on_bar',
)


def history_digest(games):
    digest = hashlib.sha256()
    for part in json.JSONEncoder(sort_keys=True, separators=(',', ':')).iterencode(games):
        digest.update(part.encode())
    return digest.hexdigest()


def replay_reference(match):
    return {'v': 1, 'match_id': str(match.pk), 'game_count': len(match.games),
            'sha256': history_digest(match.games)}


def replay_page(games, *, game_index=0, turn_offset=0, limit=REPLAY_PAGE_TURNS):
    """Bound response bytes as well as turn count; never truncate a turn."""
    if not games:
        if game_index or turn_offset:
            raise ValueError('Replay position is out of range.')
        return {'game_count': 0, 'game_index': 0, 'game': None,
                'turn_offset': 0, 'turn_count': 0, 'next_offset': None}
    if not 0 <= game_index < len(games):
        raise ValueError('Replay position is out of range.')
    game = games[game_index]
    turns = game.get('transcript') or []
    if turn_offset > len(turns):
        raise ValueError('Replay position is out of range.')
    page = {'game_count': len(games), 'game_index': game_index,
            'game': {key: game[key] for key in GAME_SUMMARY_FIELDS if key in game},
            'turn_offset': turn_offset, 'turn_count': len(turns), 'next_offset': None}
    page['game']['transcript'] = []
    for turn in turns[turn_offset:turn_offset + limit]:
        page['game']['transcript'].append(turn)
        page['next_offset'] = turn_offset + len(page['game']['transcript'])
        if len(json.dumps(page, separators=(',', ':')).encode()) > REPLAY_MAX_BYTES - 512:
            page['game']['transcript'].pop()
            if not page['game']['transcript']:
                raise ValueError('A replay turn exceeds the response limit.')
            break
    end = turn_offset + len(page['game']['transcript'])
    page['next_offset'] = end if end < len(turns) else None
    if len(json.dumps(page, separators=(',', ':')).encode()) > REPLAY_MAX_BYTES - 512:
        raise ValueError('Replay metadata exceeds the response limit.')
    return page


@csrf_exempt
@require_POST
def read_replay(request):
    if not settings.GAMELINK_ENABLED:
        return JsonResponse({'detail': 'Not found.'}, status=404)
    try:
        if int(request.META.get('CONTENT_LENGTH') or 0) > 4096:
            raise ValueError()
        raw = request.body
    except (ValueError, RequestDataTooBig):
        return JsonResponse({'detail': 'Request too large.'}, status=413)
    if len(raw) > 4096:
        return JsonResponse({'detail': 'Request too large.'}, status=413)
    timestamp = request.headers.get('X-Gamelink-Timestamp', '')
    issuer = request.headers.get('X-Gamelink-Issuer', '')
    try:
        valid_time = abs(int(time.time()) - int(timestamp)) <= settings.GAMELINK_COMMAND_CLOCK_SKEW
    except (TypeError, ValueError):
        valid_time = False
    if (issuer not in settings.GAMELINK_ACCEPTED_ISSUERS or not valid_time
            or not verify_command_signature(raw, timestamp, request.headers.get('X-Gamelink-Signature'))):
        return JsonResponse({'detail': 'Unauthorized.'}, status=401)
    try:
        body = json.loads(raw)
        if (not isinstance(body, dict) or body.get('v') != 1 or body.get('action') != 'read_replay'
                or body.get('issuer') != issuer):
            raise ValueError()
        fixture_id = body['fixture_id']
        if type(fixture_id) is not int:
            raise ValueError()
        room_id = str(uuid.UUID(body['room_id']))
        match_id = str(uuid.UUID(body['match_id']))
        game_index, turn_offset = body.get('game_index', 0), body.get('turn_offset', 0)
        limit = body.get('limit', REPLAY_PAGE_TURNS)
        if (any(type(value) is not int or value < 0 for value in (game_index, turn_offset))
                or type(limit) is not int or not 1 <= limit <= REPLAY_PAGE_TURNS):
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        return JsonResponse({'detail': 'Invalid replay request.'}, status=400)
    link = TournamentLink.objects.filter(issuer=issuer, fixture_id=fixture_id, room_id=room_id).first()
    frozen = link.result_body if link else None
    if not isinstance(frozen, dict) or frozen.get('match_id') != match_id:
        return JsonResponse({'detail': 'Replay not found.'}, status=404)
    match = Match.objects.filter(pk=match_id, room_id=room_id).first()
    if match is None:
        return JsonResponse({'detail': 'Replay not found.'}, status=404)
    reference = frozen.get('replay')
    if isinstance(reference, dict) and reference != replay_reference(match):
        return JsonResponse({'detail': 'Replay does not match the recorded result.'}, status=409)
    try:
        page = replay_page(match.games, game_index=game_index, turn_offset=turn_offset, limit=limit)
    except (ValueError, TypeError, AttributeError):
        return JsonResponse({'detail': 'Replay position is unavailable.'}, status=400)
    response = JsonResponse({'match_id': match_id, **page}, json_dumps_params={'separators': (',', ':')})
    response['Cache-Control'] = 'private, no-store'
    return response
