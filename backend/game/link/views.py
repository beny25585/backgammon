"""
Ticket redemption.

One endpoint, reached by a browser following a redirect from the tournaments server. It verifies
the ticket, spends it, provisions the room for the fixture, seats the player, and hands the SPA a
session in the URL fragment.

Everything happens in one transaction: if any part of it fails, the ticket is *not* spent and the
player can click through again.
"""

import logging
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
from .signing import TicketError, redact, verify_ticket

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
            color = link.color_for_seat(seat)

            elsewhere = GameRoom.objects.filter(
                players__player=player,
                status__in=['waiting', 'playing'],
            ).exclude(pk=room.pk).first()
            if elsewhere is not None:
                raise _BusyElsewhere(elsewhere)

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
    except _BusyElsewhere as busy:
        logger.info(f"link enter refused: user busy in room={busy.room.code}")
        return Response(
            {'error': 'Finish or cancel your current game before starting this one.',
             'activeRoom': busy.room.code},
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


def _link_for_fixture(issuer, ticket):
    """
    Return `(link, room)` for this fixture, creating both on the first redemption.

    Two players can redeem at the same instant; the unique constraint on `(issuer, fixture_id)`
    decides which one creates, and the loser re-reads the winner's row from the savepoint.
    """
    link = TournamentLink.objects.filter(issuer=issuer, fixture_id=ticket['fix']).first()
    if link is not None:
        return link, link.room

    initial = BackgammonEngine.get_initial_state()
    initial['doublingEnabled'] = bool(ticket.get('dbl', True))
    try:
        with transaction.atomic():
            room = GameRoom.objects.create(
                code=generate_room_code(),
                status='waiting',
                target_points=ticket['tp'],
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
        return link, link.room

    logger.info(f"link room provisioned: issuer={issuer} fixture={ticket['fix']} room={room.code}")
    return link, room


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
            'return': f"{settings.GAMELINK_TOURNAMENTS_FRONTEND_URL.rstrip('/')}/tournaments",
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


class _BusyElsewhere(Exception):
    """Raised inside the transaction: the player is mid-game in a room that is not this one."""

    def __init__(self, room):
        super().__init__(room.code)
        self.room = room
