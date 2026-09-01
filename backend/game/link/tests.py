"""
Tests for ticket redemption and room provisioning.

The tournaments server is a separate repository and shares no code with this one, so most of these
tests mint their own tickets with `django.core.signing` exactly as the wire format specifies —
which makes them a *restatement* of the contract rather than a check of it.

The exception, and the reason a drift cannot pass unnoticed, is the pair of golden vectors:
`TicketContractTests` pins a token the real issuer minted and `ResultSignatureContractTests` pins
a signature the real tournaments verifier accepted. Both are pinned identically in that repo's
`gamelink/tests.py`, so a change to either wire format turns one of the two suites red instead of
leaving both green while the link quietly stops working.
"""

import json
import time
import uuid
from datetime import timedelta
from io import StringIO
from urllib.parse import parse_qs
from unittest.mock import AsyncMock, patch

import httpx
from django.contrib import admin as django_admin
from django.contrib.auth.models import User
from django.core import signing
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.signing import b64_decode, b64_encode
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from game.admin import TaskAdmin
from game.engine import BackgammonEngine
from game.game_service import finalize_room, record_game_end
from game.models import GameRoom, Match, Player, RoomPlayer, Task
from game.tasks import expire_waiting_rooms

from .housekeeping import purge_redeemed_tickets
from .identity import resolve_user
from .models import LinkedIdentity, RedeemedTicket, TournamentLink
from .outbox import build_result_body, deliver_result, enqueue_result
from .signing import (
    TICKET_SALT,
    TicketError,
    redact,
    result_signature_base,
    sign_result_body,
    verify_ticket,
)

# Fake, obviously non-production secrets. Long enough to satisfy `game.link.checks`.
TICKET_SECRET = "test-ticket-secret-not-a-real-one-0123456789"
ROTATED_SECRET = "test-rotated-secret-not-a-real-one-9876543210"
WRONG_SECRET = "test-wrong-secret-not-a-real-one-5555555555"
RESULT_SECRET = "test-result-secret-not-a-real-one-0123456789"

FRONTEND_URL = "https://play.example"
TOURNAMENTS_FRONTEND_URL = "https://tournaments-ui.example"
ENTER_URL = "/api/link/enter/"

link_settings = override_settings(
    GAMELINK_ENABLED=True,
    GAMELINK_TICKET_SECRETS=[TICKET_SECRET],
    GAMELINK_RESULT_SECRET=RESULT_SECRET,
    GAMELINK_TOURNAMENTS_URL="https://tournaments.example",
    GAMELINK_TOURNAMENTS_FRONTEND_URL=TOURNAMENTS_FRONTEND_URL,
    GAMELINK_FRONTEND_URL=FRONTEND_URL,
)


def make_ticket(secret=TICKET_SECRET, **overrides):
    """Mint a ticket in the wire format of plan §3.1."""
    issued_at = int(time.time())
    payload = {
        "v": 1,
        "iss": "tournaments",
        "aud": "backgammon",
        "jti": str(uuid.uuid4()),
        "iat": issued_at,
        "exp": issued_at + 120,
        "sub": str(uuid.uuid4()),
        "name": "alice",
        "trn": 17,
        "fix": 482,
        "seat": "p1",
        "opp": "bob",
        "tp": 1,
    }
    payload.update(overrides)
    return signing.dumps(payload, key=secret, salt=TICKET_SALT, compress=False)


def tamper(token, **claims):
    """Rewrite claims in a signed token without re-signing it."""
    head, rest = token.split(":", 1)
    payload = json.loads(b64_decode(head.encode()).decode())
    payload.update(claims)
    forged = b64_encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return f"{forged}:{rest}"


class LinkTestBase(TestCase):

    def setUp(self):
        self.client = APIClient()

    def enter(self, token):
        return self.client.get(ENTER_URL, {"ticket": token})

    def assertNothingRedeemed(self):
        self.assertEqual(RedeemedTicket.objects.count(), 0)
        self.assertEqual(TournamentLink.objects.count(), 0)
        self.assertEqual(GameRoom.objects.count(), 0)
        self.assertEqual(LinkedIdentity.objects.count(), 0)


@link_settings
class EnterLinkTests(LinkTestBase):

    def test_a_valid_ticket_provisions_user_room_and_seat(self):
        response = self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p1", tp=5))

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith(f"{FRONTEND_URL}/link#"), response["Location"])
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["Cache-Control"], "no-store")

        identity = LinkedIdentity.objects.get()
        self.assertEqual(identity.issuer, "tournaments")
        self.assertTrue(identity.user.username.startswith("t_"))
        self.assertFalse(identity.user.has_usable_password())
        self.assertEqual(Player.objects.get(user=identity.user).nickname, "alice")

        link = TournamentLink.objects.get()
        self.assertEqual(link.tournament_id, 17)
        self.assertEqual(link.fixture_id, 482)
        self.assertEqual(link.result_status, "pending")

        room = link.room
        self.assertEqual(room.status, "waiting")
        self.assertEqual(room.target_points, 5)
        self.assertTrue(room.state)
        self.assertEqual(room.players.get().color, "white")
        self.assertEqual(RedeemedTicket.objects.get().issuer, "tournaments")

    def test_the_fragment_carries_a_usable_session_for_the_right_room(self):
        response = self.enter(make_ticket())

        fragment_text = response["Location"].split("#", 1)[1]
        fragment = dict(pair.split("=", 1) for pair in fragment_text.split("&"))
        room = TournamentLink.objects.get().room
        user = LinkedIdentity.objects.get().user

        self.assertEqual(fragment["room"], str(room.id))
        self.assertEqual(fragment["color"], "white")
        self.assertEqual(parse_qs(fragment_text)["return"], [f"{TOURNAMENTS_FRONTEND_URL}/tournaments"])
        self.assertEqual(fragment["tournament"], "17")
        self.assertEqual(AccessToken(fragment["access"])["user_id"], user.id)
        self.assertIn("refresh", fragment)

        # Scoped to the match, not the 24-hour default an ordinary login gets.
        token = AccessToken(fragment["access"])
        self.assertLessEqual(token["exp"] - token["iat"], 2 * 60 * 60)

    def test_the_ticket_is_not_echoed_into_the_redirect(self):
        token = make_ticket()
        response = self.enter(token)

        self.assertNotIn(token, response["Location"])

    def test_both_seats_land_in_one_room_with_opposite_colours(self):
        first = self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p1", name="alice"))
        second = self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p2", name="bob"))

        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)

        self.assertEqual(GameRoom.objects.count(), 1)
        self.assertEqual(TournamentLink.objects.count(), 1)

        room = TournamentLink.objects.get().room
        self.assertEqual(
            dict(room.players.values_list("player__nickname", "color")),
            {"alice": "white", "bob": "black"})

        # The room starts when the second seat is filled, not when that player opens a socket.
        room.refresh_from_db()
        self.assertEqual(room.status, "playing")

    def test_the_second_seat_wakes_the_first_player(self):
        self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p1"))
        with patch("game.link.views.get_channel_layer") as get_layer:
            get_layer.return_value.group_send = AsyncMock()
            self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p2"))

        room = TournamentLink.objects.get().room
        group_send = get_layer.return_value.group_send
        group_send.assert_called_once()
        self.assertEqual(group_send.call_args[0][0], f"game_{room.id}")
        self.assertEqual(group_send.call_args[0][1], {"type": "room_started"})

    def test_the_first_seat_alone_does_not_start_the_room(self):
        with patch("game.link.views.get_channel_layer") as get_layer:
            get_layer.return_value.group_send = AsyncMock()
            self.enter(make_ticket(seat="p1"))

        get_layer.return_value.group_send.assert_not_called()
        self.assertEqual(TournamentLink.objects.get().room.status, "waiting")

    def test_the_same_player_may_click_through_twice(self):
        subject = str(uuid.uuid4())
        first = self.enter(make_ticket(sub=subject, seat="p1"))
        second = self.enter(make_ticket(sub=subject, seat="p1"))

        self.assertEqual(first.status_code, 302)
        self.assertEqual(second.status_code, 302)

        # A fresh ticket each time, but one identity, one room, one seat.
        self.assertEqual(RedeemedTicket.objects.count(), 2)
        self.assertEqual(LinkedIdentity.objects.count(), 1)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(GameRoom.objects.count(), 1)
        self.assertEqual(RoomPlayer.objects.count(), 1)

    def test_replaying_the_same_token_is_refused(self):
        token = make_ticket()
        self.assertEqual(self.enter(token).status_code, 302)

        replay = self.enter(token)
        self.assertEqual(replay.status_code, 409)
        self.assertIn("already been used", replay.data["error"])
        self.assertEqual(RedeemedTicket.objects.count(), 1)
        self.assertEqual(RoomPlayer.objects.count(), 1)

    def test_a_player_already_in_another_game_is_told_to_finish_it(self):
        subject = str(uuid.uuid4())
        self.enter(make_ticket(sub=subject, fix=1, seat="p1"))

        response = self.enter(make_ticket(sub=subject, fix=2, seat="p1"))

        self.assertEqual(response.status_code, 409)
        self.assertIn("Finish or cancel", response.data["error"])

        # The refusal rolls the whole transaction back, so the second fixture leaves no orphan
        # room behind *and* its ticket is not spent — the player can use the same link again once
        # they have finished the game they are in.
        self.assertEqual(GameRoom.objects.count(), 1)
        self.assertEqual(TournamentLink.objects.count(), 1)
        self.assertEqual(RoomPlayer.objects.count(), 1)
        self.assertEqual(RedeemedTicket.objects.count(), 1)

    def test_a_seat_claimed_by_two_different_players_is_refused(self):
        # A well-behaved issuer never mints this, so it means a confused or forged issuer. It must
        # not reach the unique constraint on (room, colour) and turn into a 500.
        self.assertEqual(self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p1")).status_code, 302)

        response = self.enter(make_ticket(sub=str(uuid.uuid4()), seat="p1"))

        self.assertEqual(response.status_code, 409)
        self.assertIn("already been taken", response.data["error"])
        self.assertEqual(RoomPlayer.objects.count(), 1)
        self.assertEqual(GameRoom.objects.count(), 1)

    def test_a_cancelled_game_does_not_block_a_new_link(self):
        subject = str(uuid.uuid4())
        self.enter(make_ticket(sub=subject, fix=1, seat="p1"))
        GameRoom.objects.update(status="cancelled")

        response = self.enter(make_ticket(sub=subject, fix=2, seat="p1"))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(RoomPlayer.objects.count(), 2)

    def test_the_endpoint_is_invisible_while_the_feature_is_disabled(self):
        with override_settings(GAMELINK_ENABLED=False):
            self.assertEqual(self.enter(make_ticket()).status_code, 404)
        self.assertNothingRedeemed()

    def test_an_unconfigured_frontend_url_refuses_before_spending_the_ticket(self):
        with override_settings(GAMELINK_FRONTEND_URL=""):
            self.assertEqual(self.enter(make_ticket()).status_code, 400)
        self.assertNothingRedeemed()


@link_settings
class TicketRejectionTests(LinkTestBase):
    """
    Every rejection is a 400 with the same body: nothing tells a prober which check it tripped.
    """

    def assertRefused(self, token):
        response = self.enter(token)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"error": "This link is not valid."})
        self.assertNothingRedeemed()

    def test_a_missing_ticket(self):
        response = self.client.get(ENTER_URL)
        self.assertEqual(response.status_code, 400)
        self.assertNothingRedeemed()

    def test_a_garbage_ticket(self):
        self.assertRefused("not-a-ticket")

    def test_a_ticket_signed_with_the_wrong_key(self):
        self.assertRefused(make_ticket(secret=WRONG_SECRET))

    def test_a_tampered_seat_claim(self):
        self.assertRefused(tamper(make_ticket(seat="p1"), seat="p2"))

    def test_a_tampered_fixture_claim(self):
        self.assertRefused(tamper(make_ticket(fix=482), fix=999))

    def test_a_ticket_whose_exp_claim_has_passed(self):
        self.assertRefused(make_ticket(exp=int(time.time()) - 1))

    def test_a_ticket_whose_signature_is_too_old(self):
        # Signed two hours ago: `signing.loads(max_age=…)` rejects it before any claim is read.
        with patch("time.time", return_value=time.time() - 7200):
            stale = make_ticket()
        self.assertRefused(stale)

    def test_a_ticket_from_an_unknown_issuer(self):
        self.assertRefused(make_ticket(iss="somebody-else"))

    def test_a_ticket_addressed_to_somebody_else(self):
        self.assertRefused(make_ticket(aud="chess"))

    def test_a_ticket_of_an_unknown_version(self):
        self.assertRefused(make_ticket(v=2))

    def test_an_unknown_seat(self):
        self.assertRefused(make_ticket(seat="p3"))

    def test_a_subject_that_is_not_a_uuid(self):
        self.assertRefused(make_ticket(sub="alice"))

    def test_a_fixture_id_that_is_not_an_integer(self):
        self.assertRefused(make_ticket(fix="482"))

    def test_a_boolean_smuggled_in_where_an_integer_belongs(self):
        # `bool` is a subclass of `int`; without an explicit guard this would sail through.
        self.assertRefused(make_ticket(fix=True))

    def test_a_missing_claim(self):
        token = make_ticket()
        head, rest = token.split(":", 1)
        payload = json.loads(b64_decode(head.encode()).decode())
        del payload["tp"]
        stripped = b64_encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
        self.assertRefused(f"{stripped}:{rest}")

    def test_a_non_positive_target(self):
        self.assertRefused(make_ticket(tp=0))


class TicketSecretRotationTests(LinkTestBase):

    @override_settings(
        GAMELINK_ENABLED=True,
        GAMELINK_FRONTEND_URL=FRONTEND_URL,
        GAMELINK_TICKET_SECRETS=[ROTATED_SECRET, TICKET_SECRET],
    )
    def test_the_old_secret_still_verifies_while_the_new_one_is_first(self):
        self.assertEqual(self.enter(make_ticket(secret=TICKET_SECRET, fix=1)).status_code, 302)
        self.assertEqual(self.enter(make_ticket(secret=ROTATED_SECRET, fix=2)).status_code, 302)

    @override_settings(
        GAMELINK_ENABLED=True,
        GAMELINK_FRONTEND_URL=FRONTEND_URL,
        GAMELINK_TICKET_SECRETS=[ROTATED_SECRET],
    )
    def test_a_dropped_secret_stops_verifying(self):
        self.assertEqual(self.enter(make_ticket(secret=TICKET_SECRET)).status_code, 400)

    @override_settings(GAMELINK_ENABLED=True, GAMELINK_TICKET_SECRETS=[])
    def test_no_configured_secret_verifies_nothing(self):
        with self.assertRaises(TicketError):
            verify_ticket(make_ticket())


@link_settings
class IdentityTests(TestCase):

    def test_a_username_collision_does_not_merge_the_accounts(self):
        external_id = str(uuid.uuid4())
        squatted = f"t_{uuid.UUID(external_id).hex[:12]}"
        local = User.objects.create_user(username=squatted, password="local-password")

        linked = resolve_user("tournaments", external_id, "alice")

        self.assertNotEqual(linked.pk, local.pk)
        self.assertNotEqual(linked.username, local.username)
        self.assertTrue(linked.username.startswith(squatted))

        # The pre-existing account keeps its password and gains no linked identity.
        local.refresh_from_db()
        self.assertTrue(local.check_password("local-password"))
        self.assertFalse(local.linked_identities.exists())

    def test_the_same_subject_always_resolves_to_the_same_user(self):
        external_id = str(uuid.uuid4())

        first = resolve_user("tournaments", external_id, "alice")
        second = resolve_user("tournaments", external_id, "renamed")

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LinkedIdentity.objects.count(), 1)
        self.assertEqual(User.objects.count(), 1)

    def test_two_issuers_sharing_an_external_id_stay_separate(self):
        external_id = str(uuid.uuid4())

        first = resolve_user("tournaments", external_id, "alice")
        second = resolve_user("other-league", external_id, "alice")

        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(LinkedIdentity.objects.count(), 2)

    def test_a_linked_account_cannot_be_logged_into(self):
        user = resolve_user("tournaments", str(uuid.uuid4()), "alice")

        self.assertFalse(user.has_usable_password())
        self.assertIsNone(
            APIClient().post("/api/login/", {"username": user.username, "password": ""}).data.get("access"))

    def test_a_long_display_name_is_truncated_to_the_nickname_field(self):
        user = resolve_user("tournaments", str(uuid.uuid4()), "x" * 100)

        self.assertEqual(len(Player.objects.get(user=user).nickname), 30)


class RedactTests(TestCase):

    def test_a_ticket_in_a_query_string_is_blanked(self):
        self.assertEqual(
            redact("GET /api/link/enter/?ticket=abc.def:123:sig failed"),
            "GET /api/link/enter/?ticket=[redacted] failed")

    def test_a_signature_header_is_blanked(self):
        self.assertEqual(redact("X-Gamelink-Signature: v1=deadbeef"), "X-Gamelink-Signature: [redacted]")

    def test_none_survives(self):
        self.assertIsNone(redact(None))


@override_settings(DEBUG=False)
class ConfigurationCheckTests(TestCase):

    SOUND = dict(
        GAMELINK_ENABLED=True,
        GAMELINK_TICKET_SECRETS=[TICKET_SECRET],
        GAMELINK_RESULT_SECRET=RESULT_SECRET,
        GAMELINK_TOURNAMENTS_URL="https://tournaments.example",
        GAMELINK_FRONTEND_URL=FRONTEND_URL,
    )

    def run_checks(self, **overrides):
        from .checks import check_gamelink_configuration

        with override_settings(**{**self.SOUND, **overrides}):
            return [error.id for error in check_gamelink_configuration(None)]

    def test_a_sound_configuration_passes(self):
        self.assertEqual(self.run_checks(), [])

    def test_the_guard_is_silent_while_the_feature_is_off(self):
        self.assertEqual(self.run_checks(GAMELINK_ENABLED=False, GAMELINK_TICKET_SECRETS=[]), [])

    def test_the_guard_is_silent_in_debug(self):
        with override_settings(DEBUG=True):
            self.assertEqual(self.run_checks(GAMELINK_TICKET_SECRETS=[]), [])

    def test_a_missing_ticket_secret(self):
        self.assertIn("gamelink.E001", self.run_checks(GAMELINK_TICKET_SECRETS=[]))

    def test_a_short_ticket_secret(self):
        self.assertIn("gamelink.E001", self.run_checks(GAMELINK_TICKET_SECRETS=[TICKET_SECRET, "short"]))

    def test_a_missing_result_secret(self):
        self.assertIn("gamelink.E002", self.run_checks(GAMELINK_RESULT_SECRET=""))

    def test_the_two_channels_must_not_share_a_secret(self):
        self.assertIn("gamelink.E003", self.run_checks(GAMELINK_RESULT_SECRET=TICKET_SECRET))

    def test_a_secret_must_not_be_the_django_secret_key(self):
        self.assertIn("gamelink.E004", self.run_checks(SECRET_KEY=TICKET_SECRET))

    def test_a_plain_http_tournaments_url(self):
        self.assertIn("gamelink.E005", self.run_checks(GAMELINK_TOURNAMENTS_URL="http://tournaments.example"))

    def test_a_plain_http_frontend_url(self):
        self.assertIn("gamelink.E006", self.run_checks(GAMELINK_FRONTEND_URL="http://play.example"))

    def test_an_unconfigured_feature_reports_everything_at_once(self):
        errors = self.run_checks(
            GAMELINK_TICKET_SECRETS=[],
            GAMELINK_RESULT_SECRET="",
            GAMELINK_TOURNAMENTS_URL="",
            GAMELINK_FRONTEND_URL="")
        self.assertEqual(
            errors, ["gamelink.E001", "gamelink.E002", "gamelink.E005", "gamelink.E006"])


class SettingsTests(TestCase):

    def test_the_link_ships_disabled_and_unconfigured(self):
        from django.conf import settings

        self.assertFalse(settings.GAMELINK_ENABLED)
        self.assertEqual(settings.GAMELINK_TICKET_SECRETS, [])
        self.assertEqual(settings.GAMELINK_RESULT_SECRET, "")
        self.assertEqual(settings.GAMELINK_TOURNAMENTS_URL, "")
        self.assertEqual(settings.GAMELINK_FRONTEND_URL, "")


# ---------------------------------------------------------------------------
# Result messaging (session 5)
# ---------------------------------------------------------------------------

# The cross-repo signature contract, frozen.
#
# These constants are not a restatement of this repo's implementation: every one of them was
# checked against the *real* tournaments verifier running in its own virtualenv before being
# written down, and `verify_result_signature` accepted this exact signature over these exact
# bytes. Session 6 pins the same constants on the tournaments side. That is what makes the pair a
# contract — if either implementation drifts, one of the two suites goes red, instead of both
# staying green while the link quietly stops working in production.
RESULT_VECTOR_BODY = (
    b'{"end_reason":"bear_off","finished_at":"2026-08-27T12:02:20Z","fixture_id":482,'
    b'"match_id":"3a1f0c2b-4d5e-4a6b-8c7d-9e0f1a2b3c4d",'
    b'"room_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","score":{"p1":1,"p2":0},'
    b'"seats":{"p1":"white","p2":"black"},"status":"completed","target_points":1,'
    b'"tournament_id":17,"v":1,"winner_seat":"p1"}'
)
RESULT_VECTOR_TIMESTAMP = "1756300940"
RESULT_VECTOR_NONCE = "b31c4f0e9a7d4c1eb2f38a6d5c091e77"
RESULT_VECTOR_BASE = (
    "v1:1756300940:b31c4f0e9a7d4c1eb2f38a6d5c091e77:"
    "f0a9545b5208bd6e742413ff1c5848364b05180801624918c67242f708573b7f"
)
RESULT_VECTOR_SIGNATURE = "v1=0350ccb82111f47d231e2c1e4f04ac852f5b2d803d4333343d8d0c2c3bbf2dca"


class FakeResponse:
    """The two attributes `deliver_result` reads off an `httpx` response."""

    def __init__(self, status_code=200, text="{}"):
        self.status_code = status_code
        self.text = text


@link_settings
class ResultSignatureContractTests(TestCase):
    """Pin the wire format of an outbound result signature, byte for byte."""

    def test_the_signature_base_string_is_pinned(self):
        base = result_signature_base(
            RESULT_VECTOR_BODY, RESULT_VECTOR_TIMESTAMP, RESULT_VECTOR_NONCE)
        self.assertEqual(base.decode(), RESULT_VECTOR_BASE)

    def test_the_signature_is_pinned(self):
        signature = sign_result_body(
            RESULT_VECTOR_BODY, RESULT_VECTOR_TIMESTAMP, RESULT_VECTOR_NONCE)
        self.assertEqual(signature, RESULT_VECTOR_SIGNATURE)

    def test_the_body_enters_the_signature_as_its_digest_not_verbatim(self):
        # A one-byte change to the body has to move the signature, or the signature is not
        # committing to the bytes the receiver will parse.
        altered = sign_result_body(
            RESULT_VECTOR_BODY + b" ", RESULT_VECTOR_TIMESTAMP, RESULT_VECTOR_NONCE)
        self.assertNotEqual(altered, RESULT_VECTOR_SIGNATURE)

    def test_the_timestamp_and_nonce_are_both_committed_to(self):
        self.assertNotEqual(
            sign_result_body(RESULT_VECTOR_BODY, "1756300941", RESULT_VECTOR_NONCE),
            RESULT_VECTOR_SIGNATURE)
        self.assertNotEqual(
            sign_result_body(RESULT_VECTOR_BODY, RESULT_VECTOR_TIMESTAMP, "0" * 32),
            RESULT_VECTOR_SIGNATURE)

    def test_a_different_secret_produces_a_different_signature(self):
        with override_settings(GAMELINK_RESULT_SECRET=WRONG_SECRET):
            signature = sign_result_body(
                RESULT_VECTOR_BODY, RESULT_VECTOR_TIMESTAMP, RESULT_VECTOR_NONCE)
        self.assertNotEqual(signature, RESULT_VECTOR_SIGNATURE)

    def test_signing_without_a_configured_secret_is_refused(self):
        with override_settings(GAMELINK_RESULT_SECRET=""):
            with self.assertRaises(ImproperlyConfigured):
                sign_result_body(
                    RESULT_VECTOR_BODY, RESULT_VECTOR_TIMESTAMP, RESULT_VECTOR_NONCE)


# The cross-repo *ticket* contract, frozen — the other direction of the same idea.
#
# This token was minted by the tournaments server's own `gamelink.signing.issue_ticket` machinery
# and is pinned character for character in `gamelink/tests.py::TicketContractTest`, where it has
# to decode to the same payload. Session 3 checked the ticket direction by hand against the real
# issuer; that script is gone, and this is what replaces it.
#
# Everything else in this module mints its own tickets, which makes it a restatement of the format
# rather than a check of it: a change to the payload shape on the issuing side would leave both
# repos' suites green and the link broken. These constants are the one thing here that cannot
# drift silently.
TICKET_VECTOR_TOKEN = (
    "eyJ2IjoxLCJpc3MiOiJ0b3VybmFtZW50cyIsImF1ZCI6ImJhY2tnYW1tb24iLCJqdGkiOiI1ZjNjMWQyZS04YTRi"
    "LTRjNmQtOWUwZi0xYTJiM2M0ZDVlNmYiLCJpYXQiOjE3NTYzMDAwMDAsImV4cCI6MTc1NjMwMDEyMCwic3ViIjoi"
    "MGYyYTdiNmMtM2Q0ZS00ZjVhLThiOWMtMGQxZTJmM2E0YjVjIiwibmFtZSI6ImFsaWNlIiwidHJuIjoxNywiZml4"
    "Ijo0ODIsInNlYXQiOiJwMSIsIm9wcCI6ImJvYiIsInRwIjoxfQ:1x0Qjf:"
    "FgOctl42KMzHWqwdGqd57k_WoKZLIRZgN52CkAaCZCs"
)
TICKET_VECTOR_PAYLOAD = {
    "v": 1,
    "iss": "tournaments",
    "aud": "backgammon",
    "jti": "5f3c1d2e-8a4b-4c6d-9e0f-1a2b3c4d5e6f",
    "iat": 1756300000,
    "exp": 1756300120,
    "sub": "0f2a7b6c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
    "name": "alice",
    "trn": 17,
    "fix": 482,
    "seat": "p1",
    "opp": "bob",
    "tp": 1,
}


@link_settings
class TicketContractTests(TestCase):
    """Pin the wire format of an inbound ticket against a token the issuer actually produced."""

    def test_the_pinned_ticket_decodes_to_the_documented_payload(self):
        # Pins the salt, the key derivation, the serializer, the encoding and every claim name at
        # once — everything this verifier has to agree with the issuer about.
        payload = signing.loads(
            TICKET_VECTOR_TOKEN, key=TICKET_SECRET, salt=TICKET_SALT, max_age=None)
        self.assertEqual(payload, TICKET_VECTOR_PAYLOAD)

    def test_the_real_verifier_gets_past_the_signature_on_the_pinned_ticket(self):
        # A pinned token is expired by construction — that is what makes it reproducible — so the
        # furthest it can get is the expiry check. Reaching *that* is the point: a token the
        # shared secret did not sign is refused earlier, with a different reason, which the next
        # test pins so that this one cannot pass for the wrong reason.
        with self.assertRaises(TicketError) as refusal:
            verify_ticket(TICKET_VECTOR_TOKEN)
        self.assertEqual(str(refusal.exception), "ticket has expired")

    def test_a_ticket_the_shared_secret_did_not_sign_fails_differently(self):
        with override_settings(GAMELINK_TICKET_SECRETS=[WRONG_SECRET]):
            with self.assertRaises(TicketError) as refusal:
                verify_ticket(TICKET_VECTOR_TOKEN)
        self.assertEqual(str(refusal.exception), "no configured secret verifies this ticket")

    def test_the_verifier_accepts_the_claim_set_the_issuer_mints(self):
        # The claims are the pinned ones and only `exp` moves, because an unexpired token cannot
        # be written down. This is what proves the *whole* public path accepts what tournaments
        # sends — version, issuer, audience, every required claim and its type, the seat, the
        # target points and the subject.
        fresh = signing.dumps(
            dict(TICKET_VECTOR_PAYLOAD, exp=int(time.time()) + 120),
            key=TICKET_SECRET,
            salt=TICKET_SALT,
            compress=False)

        claims = verify_ticket(fresh)

        self.assertEqual(claims["seat"], "p1")
        self.assertEqual(claims["trn"], 17)
        self.assertEqual(claims["fix"], 482)
        self.assertEqual(claims["tp"], 1)
        self.assertEqual(claims["sub"], "0f2a7b6c-3d4e-4f5a-8b9c-0d1e2f3a4b5c")

    def test_a_tampered_claim_breaks_the_signature(self):
        _, timestamp, signature = TICKET_VECTOR_TOKEN.split(":")
        forged = b64_encode(
            json.dumps(
                dict(TICKET_VECTOR_PAYLOAD, fix=999), separators=(",", ":")).encode()).decode()

        with self.assertRaises(TicketError):
            verify_ticket(f"{forged}:{timestamp}:{signature}")

class ResultTestBase(TestCase):
    """A linked room, ready to produce a result."""

    def setUp(self):
        self.client = APIClient()
        self.room = self.make_room()
        self.link = TournamentLink.objects.create(
            issuer="tournaments", tournament_id=17, fixture_id=482, room=self.room)

    def make_room(self, code="RES001", status="playing", target_points=1, **overrides):
        return GameRoom.objects.create(
            code=code, status=status, target_points=target_points, state={}, **overrides)

    def seat(self, room, color, username):
        player = Player.objects.create(user=User.objects.create_user(username=username))
        return RoomPlayer.objects.create(room=room, player=player, color=color)

    def seat_both(self, room=None):
        room = room or self.room
        return (self.seat(room, "white", f"w-{room.code}"),
                self.seat(room, "black", f"b-{room.code}"))

    def winning_state(self, winner="white"):
        state = BackgammonEngine.get_initial_state()
        state.update({"winner": winner, "winType": "single", "cube": 1})
        return state

    def body(self):
        self.link.refresh_from_db()
        return self.link.result_body


@link_settings
class ResultBodyTests(ResultTestBase):
    """The §3.2 body: scores reach the receiver mapped onto seats, never onto colours."""

    def test_the_body_carries_every_field_the_wire_format_specifies(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        body = self.body()
        self.assertEqual(set(body), {
            "v", "tournament_id", "fixture_id", "room_id", "match_id", "status",
            "target_points", "seats", "score", "winner_seat", "end_reason", "finished_at",
            "match_details"})
        self.assertEqual(body["v"], 1)
        self.assertEqual(body["tournament_id"], 17)
        self.assertEqual(body["fixture_id"], 482)
        self.assertEqual(body["room_id"], str(self.room.id))
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["target_points"], 1)
        self.assertEqual(body["end_reason"], "bear_off")
        self.assertEqual(body["match_details"]["winner"], "white")
        self.assertEqual(body["match_details"]["final_cube"], 1)
        self.assertEqual(body["match_details"]["games"][0]["winner"], "white")
        self.assertEqual(body["match_details"]["games"][0]["points_awarded"], 1)
        self.assertRegex(body["finished_at"], r"\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z")

    def test_seats_and_score_follow_seat_p1_color(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        body = self.body()
        self.assertEqual(body["seats"], {"p1": "white", "p2": "black"})
        self.assertEqual(body["score"], {"p1": 1, "p2": 0})
        self.assertEqual(body["winner_seat"], "p1")

    def test_the_mapping_inverts_when_p1_is_black(self):
        # The same white win has to arrive as a *p2* win when p1 took the black seat. This is the
        # whole reason the sender maps to seats: the receiver knows nothing about colours.
        self.link.seat_p1_color = "black"
        self.link.save(update_fields=["seat_p1_color"])
        self.seat_both()

        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        body = self.body()
        self.assertEqual(body["seats"], {"p1": "black", "p2": "white"})
        self.assertEqual(body["score"], {"p1": 0, "p2": 1})
        self.assertEqual(body["winner_seat"], "p2")

    def test_a_cancelled_result_names_no_winner(self):
        body = build_result_body(
            self.link, self.room, None, status="cancelled", end_reason="expired")
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["winner_seat"])
        self.assertIsNone(body["match_id"])
        self.assertIsNone(body["match_details"])

    def test_the_match_id_is_the_saved_match(self):
        self.seat_both()
        result = record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")
        self.assertEqual(self.body()["match_id"], str(result["match"].id))


@link_settings
class EnqueueResultTests(ResultTestBase):
    """Which endings produce an outbound message, and which must not."""

    def test_a_finished_linked_match_enqueues_exactly_one_task(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        task = Task.objects.get()
        self.assertEqual(task.name, "game.link.outbox.deliver_result")
        self.assertEqual(task.kwargs, {"link_id": self.link.pk})
        self.assertEqual(task.status, "pending")
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "queued")

    def test_the_queued_task_is_visible_to_run_tasks(self):
        # `run_tasks` selects on `run_at__lte=now`, which a NULL `run_at` never satisfies. A task
        # queued without a stamp would sit pending forever and nothing would say so.
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        self.assertIsNotNone(Task.objects.get().run_at)
        self.assertTrue(
            Task.objects.filter(status="pending", run_at__lte=timezone.now()).exists())

    def test_a_finished_unlinked_match_enqueues_nothing(self):
        room = self.make_room(code="PLAIN1")
        self.seat_both(room)

        record_game_end(room, self.winning_state(), "white", "single", "bear_off")

        self.assertEqual(Task.objects.count(), 0)

    def test_a_game_that_does_not_end_the_match_enqueues_nothing(self):
        # Mid-match game ends are not fixture results. Only reaching target_points is.
        self.room.target_points = 3
        self.room.save(update_fields=["target_points"])
        self.seat_both()

        result = record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        self.assertFalse(result["match_over"])
        self.assertEqual(Task.objects.count(), 0)
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "pending")

    def test_a_forced_close_reports_too(self):
        # The `leave` path: a player quits mid-match and the room is closed against them.
        self.seat_both()
        finalize_room(self.room, self.winning_state("black"), "black", "single", "leave")

        self.assertEqual(Task.objects.count(), 1)
        body = self.body()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["winner_seat"], "p2")
        self.assertEqual(body["end_reason"], "leave")

    def test_a_link_reports_only_once(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        # Anything trying to report the same fixture again is a no-op, whatever route it arrives
        # by: the first outcome is the one the tournament hears about.
        self.link.refresh_from_db()
        self.assertIsNone(enqueue_result(self.link, None, self.room, "cancelled"))
        self.assertEqual(Task.objects.count(), 1)

    def test_an_ending_that_rolls_back_queues_nothing(self):
        self.seat_both()
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")
                raise RuntimeError("something later in the request failed")

        self.assertEqual(Task.objects.count(), 0)
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "pending")


@link_settings
class DeliverResultTests(ResultTestBase):
    """Signing and POSTing a frozen result."""

    def queue(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")
        return Task.objects.get()

    def test_delivery_posts_a_signed_body_to_the_tournaments_server(self):
        self.queue()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse()) as post:
            deliver_result(self.link.pk)

        url = post.call_args.args[0]
        raw = post.call_args.kwargs["content"]
        headers = post.call_args.kwargs["headers"]

        self.assertEqual(url, "https://tournaments.example/api/gamelink/result/")
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["X-Gamelink-Issuer"], "backgammon")
        self.assertEqual(post.call_args.kwargs["timeout"], 10.0)

        # The signature must verify over the bytes actually sent, not over a re-dump of the body:
        # a different key order would still be valid JSON and an invalid signature.
        expected = sign_result_body(
            raw, headers["X-Gamelink-Timestamp"], headers["X-Gamelink-Nonce"])
        self.assertEqual(headers["X-Gamelink-Signature"], expected)
        self.assertEqual(json.loads(raw)["fixture_id"], 482)

    def test_a_success_marks_the_link_delivered(self):
        self.queue()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(204)):
            deliver_result(self.link.pk)

        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "delivered")
        self.assertIsNotNone(self.link.delivered_at)

    def test_a_refusal_raises_and_leaves_the_link_queued(self):
        self.queue()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(500)):
            with self.assertRaises(RuntimeError):
                deliver_result(self.link.pk)

        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "queued")
        self.assertIsNone(self.link.delivered_at)

    def test_a_transport_failure_propagates_so_the_task_retries(self):
        self.queue()
        with patch("game.link.outbox.httpx.post", side_effect=httpx.ConnectError("refused")):
            with self.assertRaises(httpx.ConnectError):
                deliver_result(self.link.pk)

    def test_an_already_delivered_link_is_not_sent_again(self):
        self.queue()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse()):
            deliver_result(self.link.pk)
        with patch("game.link.outbox.httpx.post") as post:
            deliver_result(self.link.pk)
        post.assert_not_called()

    def test_each_attempt_mints_a_fresh_timestamp_and_nonce(self):
        # The receiver rejects a replayed nonce outright, so a retry reusing one could never
        # succeed. The *body* stays identical; only these two move.
        self.queue()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(500)) as post:
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    deliver_result(self.link.pk)

        first, second = post.call_args_list
        self.assertEqual(first.kwargs["content"], second.kwargs["content"])
        self.assertNotEqual(
            first.kwargs["headers"]["X-Gamelink-Nonce"],
            second.kwargs["headers"]["X-Gamelink-Nonce"])

    def test_delivery_without_a_configured_tournaments_url_is_refused(self):
        self.queue()
        with override_settings(GAMELINK_TOURNAMENTS_URL=""):
            with self.assertRaises(RuntimeError):
                deliver_result(self.link.pk)

    def test_the_immediate_attempt_runs_on_commit_and_marks_the_task_done(self):
        self.seat_both()
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse()) as post:
            with self.captureOnCommitCallbacks(execute=True):
                record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        post.assert_called_once()
        self.assertEqual(Task.objects.get().status, "done")
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "delivered")

    def test_a_failed_immediate_attempt_is_swallowed_and_left_pending(self):
        # It runs from an on_commit hook, where raising would report an error for a request whose
        # work has already succeeded. The Task row is the durable path and must survive.
        self.seat_both()
        with patch("game.link.outbox.httpx.post", side_effect=httpx.ConnectError("refused")):
            with self.captureOnCommitCallbacks(execute=True):
                record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        task = Task.objects.get()
        self.assertEqual(task.status, "pending")
        self.assertEqual(task.attempts, 1)
        self.assertIn("refused", task.last_error)


@link_settings
class DeliveryRetryTests(ResultTestBase):
    """What `manage.py run_tasks` does with a delivery the receiver refuses."""

    def run_tasks(self):
        call_command("run_tasks", stdout=StringIO())

    def test_a_refused_delivery_stays_pending_with_a_pushed_out_run_at(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")
        before = Task.objects.get().run_at

        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(500)):
            self.run_tasks()

        task = Task.objects.get()
        self.assertEqual(task.status, "pending")
        self.assertEqual(task.attempts, 1)
        self.assertGreater(task.run_at, before)
        self.assertIn("HTTP 500", task.last_error)

    def test_a_delivery_that_keeps_failing_eventually_gives_up(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(500)):
            for _ in range(3):
                Task.objects.update(run_at=timezone.now())
                self.run_tasks()

        task = Task.objects.get()
        self.assertEqual(task.status, "failed")
        self.assertEqual(task.attempts, 3)
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "queued")

    def test_a_retry_succeeds_and_marks_the_link_delivered(self):
        self.seat_both()
        record_game_end(self.room, self.winning_state(), "white", "single", "bear_off")

        with patch("game.link.outbox.httpx.post", return_value=FakeResponse(503)):
            self.run_tasks()
        Task.objects.update(run_at=timezone.now())
        with patch("game.link.outbox.httpx.post", return_value=FakeResponse()):
            self.run_tasks()

        self.assertEqual(Task.objects.get().status, "done")
        self.link.refresh_from_db()
        self.assertEqual(self.link.result_status, "delivered")


@link_settings
class AbandonedFixtureTests(ResultTestBase):
    """Expiry of a linked room — plan §9 decision 2, answered as auto-forfeit."""

    def setUp(self):
        super().setUp()
        self.room.status = "waiting"
        self.room.save(update_fields=["status"])

    def age(self, room=None, minutes=90):
        room = room or self.room
        GameRoom.objects.filter(pk=room.pk).update(
            updated_at=timezone.now() - timedelta(minutes=minutes))

    def test_the_player_who_turned_up_wins_by_forfeit(self):
        self.seat(self.room, "white", "showed-up")
        self.age()

        self.assertEqual(expire_waiting_rooms(minutes=60), 1)

        body = self.body()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["winner_seat"], "p1")
        self.assertEqual(body["end_reason"], "forfeit")
        self.assertIsNone(body["match_id"])
        self.assertEqual(Task.objects.count(), 1)

    def test_a_forfeit_is_scored_as_a_full_length_win(self):
        self.room.target_points = 5
        self.room.save(update_fields=["target_points"])
        self.seat(self.room, "black", "showed-up")
        self.age()

        expire_waiting_rooms(minutes=60)

        self.assertEqual(self.body()["score"], {"p1": 0, "p2": 5})
        self.assertEqual(self.body()["winner_seat"], "p2")

    def test_the_room_is_cancelled_even_though_the_fixture_completed(self):
        # The two statuses answer different questions: no game was played here, but the fixture
        # has a definite winner. Backgammon must not claim a match it never ran.
        self.seat(self.room, "white", "showed-up")
        self.age()

        expire_waiting_rooms(minutes=60)

        self.room.refresh_from_db()
        self.assertEqual(self.room.status, "cancelled")
        self.assertEqual(Match.objects.count(), 0)

    def test_a_room_nobody_sat_in_releases_the_fixture_instead(self):
        self.age()

        expire_waiting_rooms(minutes=60)

        body = self.body()
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["winner_seat"])
        self.assertEqual(body["end_reason"], "expired")

    def test_a_full_room_that_never_started_releases_the_fixture(self):
        # No basis for choosing a winner between two players who both turned up.
        self.seat_both()
        self.age()

        expire_waiting_rooms(minutes=60)

        self.assertEqual(self.body()["status"], "cancelled")

    def test_an_unlinked_room_expires_silently_as_before(self):
        room = self.make_room(code="PLAIN2", status="waiting")
        self.seat(self.room, "white", "showed-up")
        self.age(room)
        self.age()

        self.assertEqual(expire_waiting_rooms(minutes=60), 2)

        room.refresh_from_db()
        self.assertEqual(room.status, "cancelled")
        self.assertEqual(Task.objects.count(), 1)

    def test_a_room_that_is_not_stale_is_left_alone(self):
        self.seat(self.room, "white", "showed-up")

        self.assertEqual(expire_waiting_rooms(minutes=60), 0)

        self.room.refresh_from_db()
        self.assertEqual(self.room.status, "waiting")
        self.assertEqual(Task.objects.count(), 0)

    def test_a_second_sweep_reports_nothing_further(self):
        self.seat(self.room, "white", "showed-up")
        self.age()

        expire_waiting_rooms(minutes=60)
        self.assertEqual(expire_waiting_rooms(minutes=60), 0)

        self.assertEqual(Task.objects.count(), 1)


@link_settings
class CancelledRoomTests(ResultTestBase):
    """An explicit cancellation releases the fixture rather than deciding it."""

    def test_cancelling_a_linked_room_reports_it_cancelled(self):
        seat = self.seat(self.room, "white", "quitter")
        self.client.force_authenticate(user=seat.player.user)

        response = self.client.post("/api/rooms/cancel/")

        self.assertEqual(response.status_code, 200)
        body = self.body()
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["winner_seat"])
        self.assertEqual(body["end_reason"], "cancelled")

    def test_cancelling_an_unlinked_room_reports_nothing(self):
        room = self.make_room(code="PLAIN3", status="waiting")
        seat = self.seat(room, "white", "plain-quitter")
        self.client.force_authenticate(user=seat.player.user)

        self.assertEqual(self.client.post("/api/rooms/cancel/").status_code, 200)
        self.assertEqual(Task.objects.count(), 0)


# ---------------------------------------------------------------------------
# Housekeeping and the dead-letter view (session 7)
# ---------------------------------------------------------------------------


@link_settings
class PurgeRedeemedTicketsTests(TestCase):
    """
    Forgetting a spent ticket is only safe once the ticket itself can no longer be presented.

    `verify_ticket` refuses an expired ticket before redemption is even considered — by `max_age`
    on the signature and again by the `exp` claim — so a row past `expires_at` is protecting
    nothing. A row that has *not* expired is the whole replay defence, and deleting one of those
    would hand a captured ticket a second use.
    """

    def setUp(self):
        self.now = timezone.now()

    def add(self, jti, expires_in):
        return RedeemedTicket.objects.create(
            jti=jti, issuer="tournaments", expires_at=self.now + expires_in)

    def test_an_expired_ticket_is_forgotten(self):
        self.add(uuid.uuid4(), -timedelta(seconds=1))

        self.assertEqual(purge_redeemed_tickets(now=self.now), 1)
        self.assertEqual(RedeemedTicket.objects.count(), 0)

    def test_a_ticket_that_can_still_be_presented_is_kept(self):
        live = self.add(uuid.uuid4(), timedelta(seconds=1))
        # Exactly on the boundary counts as still live: `expires_at__lt` is deliberately strict.
        boundary = self.add(uuid.uuid4(), timedelta(0))

        self.assertEqual(purge_redeemed_tickets(now=self.now), 0)
        self.assertEqual(
            set(RedeemedTicket.objects.values_list("jti", flat=True)), {live.jti, boundary.jti})

    def test_only_the_expired_ones_go(self):
        for index in range(3):
            self.add(uuid.uuid4(), -timedelta(minutes=index + 1))
        kept = self.add(uuid.uuid4(), timedelta(minutes=5))

        self.assertEqual(purge_redeemed_tickets(now=self.now), 3)
        self.assertEqual(list(RedeemedTicket.objects.values_list("jti", flat=True)), [kept.jti])

    def test_a_second_run_finds_nothing_left_to_do(self):
        self.add(uuid.uuid4(), -timedelta(seconds=1))

        self.assertEqual(purge_redeemed_tickets(now=self.now), 1)
        self.assertEqual(purge_redeemed_tickets(now=self.now), 0)

    def test_a_purged_jti_can_be_spent_again_only_because_the_ticket_cannot(self):
        # The property the whole module rests on, stated as a test: an expired ticket is refused
        # by the verifier whether or not its jti is still remembered here.
        payload = dict(
            v=1, iss="tournaments", aud="backgammon", jti=str(uuid.uuid4()),
            iat=int(time.time()) - 600, exp=int(time.time()) - 300,
            sub=str(uuid.uuid4()), name="alice", trn=17, fix=482, seat="p1", opp="bob", tp=1)
        token = signing.dumps(payload, key=TICKET_SECRET, salt=TICKET_SALT, compress=False)

        self.assertEqual(RedeemedTicket.objects.count(), 0)
        with self.assertRaises(TicketError):
            verify_ticket(token)

    def test_the_command_runs_and_says_what_it_did(self):
        self.add(uuid.uuid4(), -timedelta(seconds=1))

        out = StringIO()
        call_command("purge_redeemed_tickets", stdout=out)

        self.assertIn("Purged 1 redeemed tickets", out.getvalue())
        self.assertEqual(RedeemedTicket.objects.count(), 0)


class TaskDeadLetterAdminTests(TestCase):
    """
    The admin list for `Task` is the only place a permanently failed delivery becomes visible.
    """

    def admin_for(self, model):
        return django_admin.site._registry[model]

    def test_the_task_admin_is_registered(self):
        self.assertIsInstance(self.admin_for(Task), TaskAdmin)

    def test_nothing_about_a_task_can_be_edited_from_the_admin(self):
        # A queue row is a record of what the server tried to do. Editing one would either forge
        # that record or re-arm a delivery by hand, which is what `run_tasks` is for.
        task_admin = self.admin_for(Task)

        self.assertFalse(task_admin.has_add_permission(None))
        self.assertFalse(task_admin.has_change_permission(None))
        self.assertEqual(
            set(task_admin.get_readonly_fields(None)),
            {field.name for field in Task._meta.fields})

    def test_failed_tasks_can_be_filtered_out_of_the_list(self):
        # "Dead letters" is `?status__exact=failed` on this list, so status has to be filterable.
        self.assertIn("status", self.admin_for(Task).list_filter)

    def test_the_error_column_shows_the_exception_rather_than_the_whole_traceback(self):
        task = Task.objects.create(
            name="game.link.outbox.deliver_result",
            status="failed",
            run_at=timezone.now(),
            last_error='Traceback (most recent call last):\n  File "x.py", line 1\n'
                       "RuntimeError: result delivery for fixture 482 refused with HTTP 503\n")

        self.assertEqual(
            self.admin_for(Task).error(task),
            "RuntimeError: result delivery for fixture 482 refused with HTTP 503")

    def test_a_long_error_is_truncated_and_an_absent_one_is_blank(self):
        task_admin = self.admin_for(Task)
        long_error = Task.objects.create(
            name="x", status="failed", run_at=timezone.now(), last_error="E" * 500)
        no_error = Task.objects.create(name="x", status="pending", run_at=timezone.now())

        self.assertEqual(len(task_admin.error(long_error)), 120)
        self.assertTrue(task_admin.error(long_error).endswith("..."))
        self.assertEqual(task_admin.error(no_error), "")

    def test_the_attempt_column_shows_progress_towards_giving_up(self):
        task = Task.objects.create(
            name="x", status="failed", attempts=3, max_attempts=3, run_at=timezone.now())

        self.assertEqual(self.admin_for(Task).attempt_count(task), "3/3")
