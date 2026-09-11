"""
Ticket redemption.

One endpoint, reached by a browser following a redirect from the tournaments server. It verifies
the ticket, spends it, provisions the room for the fixture, seats the player, and hands the SPA a
session in the URL fragment.

Everything happens in one transaction: if any part of it fails, the ticket is *not* spent and the
player can click through again.
"""

import json
import logging
import time
import uuid
from datetime import datetime
from datetime import timezone as dt_timezone
from urllib.parse import urlencode

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from game.engine import BackgammonEngine
from game.models import GameRoom, GameState, RoomPlayer, generate_room_code

from .identity import resolve_user
from .models import RedeemedTicket, TournamentLink
from .signing import TicketError, redact, verify_command_signature, verify_ticket

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([AllowAny])
def enter_link(request):
    """
    Redeem the ticket in `?ticket=` and send the player into their game.

    `AllowAny` is correct here and is not a gap: the ticket *is* the credential, and the caller
    has no session yet — establishing one is what this endpoint does. Nothing in it ever reads
    `request.user`.
    """
    if not settings.GAMELINK_ENABLED:
        # Invisible rather than merely refusing: a deployment that does not link tournaments
        # should not advertise that it could.
        logger.info("link enter refused: feature disabled")
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        ticket = verify_ticket(request.GET.get('ticket', ''))
    except TicketError as exc:
        logger.warning(f"link enter rejected: {redact(exc)}")
        return Response({'error': 'This link is not valid.'}, status=status.HTTP_400_BAD_REQUEST)

    frontend_url = settings.GAMELINK_FRONTEND_URL.rstrip('/')
    if not frontend_url:
        logger.error("link enter failed: GAMELINK_FRONTEND_URL is not configured")
        return Response({'error': 'This link is not valid.'}, status=status.HTTP_400_BAD_REQUEST)

    issuer = ticket['iss']
    seat = ticket['seat']

    try:
        with transaction.atomic():
            try:
                RedeemedTicket.objects.create(
                    jti=ticket['jti'],
                    issuer=issuer,
                    expires_at=datetime.fromtimestamp(ticket['exp'], tz=dt_timezone.utc),
                )
            except IntegrityError:
                raise _AlreadyRedeemed() from None

            user = resolve_user(issuer, ticket['sub'], ticket.get('name', ''))
            player = user.player

            link, room = _link_for_fixture(issuer, ticket)
            if room.status in ('completed', 'cancelled'):
                raise _RoomClosed()
            color = link.color_for_seat(seat)

            # Tournament rooms are independent. A player may have a live fixture in several
            # tournaments and use the tournaments UI to choose which one to enter, so membership
            # in another active room must neither block this ticket nor cancel that other match.
            # A well-behaved issuer never mints two tickets for the same seat of one fixture, so
            # reaching this means the issuer is confused or forged. Refuse it cleanly: without the
            # check the unique constraint on (room, colour) turns it into a 500.
            occupant = room.players.filter(color=color).first()
            if occupant is not None and occupant.player_id != player.pk:
                raise _SeatTaken(color)

            # An existing seat is kept as it is: a player who clicks the link again keeps the
            # colour they already have, whatever the new ticket says.
            seated, _ = RoomPlayer.objects.get_or_create(
                room=room, player=player, defaults={'color': color})
            started = _start_if_full(room)
    except _AlreadyRedeemed:
        logger.warning(f"link enter rejected: ticket already redeemed jti={ticket['jti']}")
        return Response(
            {'error': 'This link has already been used. Return to the tournament and open it again.'},
            status=status.HTTP_409_CONFLICT)
    except _SeatTaken as taken:
        logger.warning(
            f"link enter rejected: seat {taken.color} of fixture {ticket['fix']} is already held "
            f"by another player")
        return Response(
            {'error': 'That seat has already been taken by another player.'},
            status=status.HTTP_409_CONFLICT)
    except _RoomClosed:
        logger.info(f"link enter rejected: fixture {ticket['fix']} is already closed")
        return Response(
            {'error': 'This match has already ended.'},
            status=status.HTTP_409_CONFLICT)
    if started:
        # The room starts when the second seat is filled, not when that player's socket opens,
        # which is what wakes the first player out of the waiting room.
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(f'game_{room.id}', {'type': 'room_started'})

    logger.info(
        f"link enter: issuer={issuer} fixture={ticket['fix']} room={room.code} "
        f"seat={seat} color={seated.color} user={user.username}")

    return _handoff(user, room, seated.color, frontend_url)


@api_view(['POST'])
@permission_classes([AllowAny])
def admin_command(request):
    """Apply an authenticated, idempotent organizer score or finish command."""
    if not settings.GAMELINK_ENABLED:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    raw = request.body
    timestamp = request.headers.get('X-Gamelink-Timestamp', '')
    issuer = request.headers.get('X-Gamelink-Issuer', '')
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    if (issuer not in settings.GAMELINK_ACCEPTED_ISSUERS
            or abs(int(time.time()) - sent_at) > settings.GAMELINK_COMMAND_CLOCK_SKEW
            or not verify_command_signature(raw, timestamp, request.headers.get('X-Gamelink-Signature'))):
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    try:
        body = json.loads(raw)
        command_id = str(uuid.UUID(body['command_id']))
        room_id = str(uuid.UUID(body['room_id']))
        fixture_id = int(body['fixture_id'])
        command_revision = body['command_revision']
        action = body['action']
        score = body.get('score')
        winner_seat = body.get('winner_seat')
        reason = body.get('reason', '')
        if (body.get('v') != 1 or type(command_revision) is not int or command_revision < 1
                or action not in ('score_update', 'finish')):
            raise ValueError()
        if score is not None and (not isinstance(score, list) or len(score) != 2
                                  or any(value is not None and (type(value) is not int or value < 0)
                                         for value in score)):
            raise ValueError()
        if action == 'finish' and (winner_seat not in ('p1', 'p2') or not isinstance(reason, str)
                                   or not reason.strip() or len(reason) > 1000):
            raise ValueError()
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return Response({'error': 'Invalid command'}, status=status.HTTP_400_BAD_REQUEST)

    event = None
    with transaction.atomic():
        link = (TournamentLink.objects.select_for_update().select_related('room')
                .filter(issuer=issuer, fixture_id=fixture_id, room_id=room_id).first())
        if link is None:
            return Response({'error': 'Linked room not found'}, status=status.HTTP_404_NOT_FOUND)
        room = link.room
        game_state, _ = GameState.objects.select_for_update().get_or_create(room=room)
        state = dict(game_state.state_data or {})
        if state.get('adminCommandId') == command_id:
            return Response({'status': 'already_applied'})
        if int(state.get('adminCommandRevision') or 0) >= command_revision:
            return Response({'status': 'already_applied'})
        if room.status in ('completed', 'cancelled'):
            return Response({'error': 'Room already closed'}, status=status.HTTP_409_CONFLICT)

        if score and score[0] is not None and score[1] is not None:
            if link.seat_p1_color == 'white':
                room.white_score, room.black_score = score
            else:
                room.black_score, room.white_score = score
        room.last_sequence += 1
        update_fields = ['white_score', 'black_score', 'last_sequence', 'updated_at']
        state['version'] = room.last_sequence
        state['adminCommandId'] = command_id
        state['adminCommandRevision'] = command_revision
        event_type = 'admin_score_updated'
        event = {
            'commandId': command_id, 'fixtureId': fixture_id,
            'whiteScore': room.white_score, 'blackScore': room.black_score,
            'targetPoints': room.target_points,
        }
        if action == 'finish':
            winner = link.color_for_seat(winner_seat)
            room.status = 'completed'
            update_fields.append('status')
            state.update(
                phase='game_over', winner=winner, winType='single', matchScored=True,
                gameEndReason='admin', adminEndReason=reason.strip(),
            )
            event_type = 'admin_match_ended'
            event.update(reason='admin', adminReason=reason.strip(), winner=winner,
                         matchOver=True, nextGame=False)
        room.save(update_fields=update_fields)
        game_state.state_data = state
        game_state.save(update_fields=['state_data', 'updated_at'])
        channel_layer = get_channel_layer()
        if channel_layer:
            transaction.on_commit(lambda: async_to_sync(channel_layer.group_send)(
                f'game_{room.id}', {'type': event_type, 'payload': event}))
    return Response({'status': 'applied'})


def _link_for_fixture(issuer, ticket):
    """
    Return `(link, room)` for this fixture, creating both on the first redemption.

    Two players can redeem at the same instant; the unique constraint on `(issuer, fixture_id)`
    decides which one creates, and the loser re-reads the winner's row from the savepoint.
    """
    link = TournamentLink.objects.filter(issuer=issuer, fixture_id=ticket['fix']).first()
    if link is not None:
        room = GameRoom.objects.select_for_update().get(pk=link.room_id)
        _sync_waiting_room_from_ticket(room, ticket)
        return link, room

    initial = BackgammonEngine.get_initial_state()
    from game.formats import apply_ticket
    apply_ticket(initial, ticket)
    try:
        with transaction.atomic():
            room = GameRoom.objects.create(
                code=generate_room_code(),
                status='waiting',
                target_points=ticket['tp'],
                time_control=ticket['tc'],
                state=initial,
            )
            GameState.objects.create(room=room, state_data=initial)
            link = TournamentLink.objects.create(
                issuer=issuer,
                tournament_id=ticket['trn'],
                fixture_id=ticket['fix'],
                room=room,
            )
    except IntegrityError:
        link = TournamentLink.objects.get(issuer=issuer, fixture_id=ticket['fix'])
        return link, GameRoom.objects.select_for_update().get(pk=link.room_id)

    logger.info(f"link room provisioned: issuer={issuer} fixture={ticket['fix']} room={room.code}")
    return link, room


def _sync_waiting_room_from_ticket(room, ticket):
    """Keep a not-yet-started linked room aligned with the latest tournament settings."""
    if room.status != 'waiting':
        return

    update_fields = []
    if room.target_points != ticket['tp']:
        room.target_points = ticket['tp']
        update_fields.append('target_points')
    if room.time_control != ticket['tc']:
        room.time_control = ticket['tc']
        update_fields.append('time_control')

    state = dict(room.state or {})
    from game.formats import apply_ticket
    apply_ticket(state, ticket)
    if state != room.state:
        room.state = state
        update_fields.append('state')
        GameState.objects.filter(room=room).update(state_data=state)

    if update_fields:
        update_fields.append('updated_at')
        room.save(update_fields=update_fields)


def _start_if_full(room):
    """Flip a full room to `playing`. Returns whether this call was the one that started it."""
    if room.status != 'waiting' or room.players.count() < 2:
        return False
    room.status = 'playing'
    room.save(update_fields=['status', 'updated_at'])
    return True


def _handoff(user, room, color, frontend_url):
    """
    Redirect into the SPA with a session in the URL *fragment*.

    A fragment is never sent to a server and never reaches an access log or a `Referer` header,
    and the landing route strips it from the address bar on arrival. The tokens are scoped to
    `GAMELINK_LINK_TOKEN_TTL` rather than the 24-hour default, so a link that leaks anyway is
    worth much less than an ordinary login.
    """
    refresh = RefreshToken.for_user(user)
    refresh['username'] = user.username
    access = refresh.access_token
    access.set_exp(lifetime=settings.GAMELINK_LINK_TOKEN_TTL)
    refresh.set_exp(lifetime=settings.GAMELINK_LINK_TOKEN_TTL)

    fragment_data = {
        'access': str(access),
        'refresh': str(refresh),
        'room': str(room.id),
        'color': color,
    }
    link = getattr(room, 'tournament_link', None)
    if link:
        fragment_data.update({
            'tournament': str(link.tournament_id),
            'return': (
                f"{settings.GAMELINK_TOURNAMENTS_FRONTEND_URL.rstrip('/')}/play"
                if link.tournament_id == 0
                else f"{settings.GAMELINK_TOURNAMENTS_FRONTEND_URL.rstrip('/')}/tournaments/"
            ),
        })
    fragment = urlencode(fragment_data)
    response = HttpResponseRedirect(f"{frontend_url}/link#{fragment}")
    response['Referrer-Policy'] = 'no-referrer'
    response['Cache-Control'] = 'no-store'
    return response


class _AlreadyRedeemed(Exception):
    """Raised inside the transaction so that its rollback and the 409 stay in one place."""


class _SeatTaken(Exception):
    """Raised inside the transaction: this fixture's seat belongs to a different player."""

    def __init__(self, color):
        super().__init__(color)
        self.color = color


class _RoomClosed(Exception):
    """Raised so a fresh ticket cannot reopen or enter a terminal linked room."""
