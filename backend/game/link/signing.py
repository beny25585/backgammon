"""
Ticket verification, and the signature over an outbound result.

The mirror image of the tournaments server's signer: `django.core.signing` over a salted
HMAC-SHA256, no new dependency on either side, and no exposure to the JWT algorithm-confusion
family of bugs because the algorithm is not attacker-controlled.

`GAMELINK_TICKET_SECRETS` is a *list* and every entry is tried, which is what makes a rotation
possible without a window where valid tickets bounce: append the new secret here, deploy, move it
to the front of the issuer's signer, deploy, then drop the old one.

Everything that can go wrong raises the same `TicketError`. The reason travels with the exception
for the log; it never reaches the requester.

The result half runs the other way: this server signs and tournaments verifies. Both directions
live here so that a single module holds every byte of the cross-repo contract.
"""

import hashlib
import hmac
import re
import time
import uuid

from django.conf import settings
from django.core import signing
from django.core.exceptions import ImproperlyConfigured

TICKET_VERSION = 1
TICKET_SALT = 'gamelink.ticket.v1'

# The outbound half. Tournaments verifies what this signs, so the two constructions have to agree
# byte for byte; `tests.ResultSignatureContractTests` pins the shared vector that says they do.
RESULT_SIGNATURE_VERSION = 'v1'

SEATS = ('p1', 'p2')

# Claims that must be present, and what each has to be, before anything downstream reads them.
REQUIRED_CLAIMS = {
    'jti': str,
    'sub': str,
    'trn': int,
    'fix': int,
    'seat': str,
    'tp': int,
}

_REDACTION_PATTERNS = (
    re.compile(r'(ticket=)[^&\s\'"]+', re.IGNORECASE),
    re.compile(r'(X-Gamelink-Signature\s*[:=]\s*)\S+', re.IGNORECASE),
)


class TicketError(Exception):
    """
    A ticket was refused. The message is for the log, never for the response body.
    """


def verify_ticket(token):
    """
    Verify `token` against every configured secret and return its claims.

    Raises `TicketError` for every failure mode — bad signature, expiry, wrong issuer or audience,
    a missing or mistyped claim — so that nothing a caller does with the exception can leak which
    check failed.

    Single use is *not* checked here. That is the redeeming view's job, because it is the database
    write that makes it atomic.
    """
    secrets = [secret for secret in getattr(settings, 'GAMELINK_TICKET_SECRETS', []) if secret]
    if not secrets:
        raise TicketError('no ticket secret is configured')

    if not isinstance(token, str) or not token:
        raise TicketError('empty ticket')

    payload = None
    for secret in secrets:
        try:
            payload = signing.loads(
                token,
                key=secret,
                salt=TICKET_SALT,
                max_age=settings.GAMELINK_TICKET_TTL,
            )
        except signing.SignatureExpired:
            # The signature was good, so trying the remaining secrets cannot help.
            raise TicketError('ticket has expired') from None
        except signing.BadSignature:
            continue
        break

    if payload is None:
        raise TicketError('no configured secret verifies this ticket')

    return _validate_claims(payload)


def _validate_claims(payload):
    if not isinstance(payload, dict):
        raise TicketError('ticket payload is not an object')

    if payload.get('v') != TICKET_VERSION:
        raise TicketError('unsupported ticket version')

    if payload.get('iss') not in settings.GAMELINK_ACCEPTED_ISSUERS:
        raise TicketError('issuer is not accepted')

    if payload.get('aud') != settings.GAMELINK_ISSUER:
        raise TicketError('audience mismatch')

    for claim, expected_type in REQUIRED_CLAIMS.items():
        value = payload.get(claim)
        # `bool` is a subclass of `int`; a JSON `true` must not pass as a fixture id.
        if isinstance(value, bool) or not isinstance(value, expected_type):
            raise TicketError(f'claim "{claim}" is missing or of the wrong type')

    if payload['seat'] not in SEATS:
        raise TicketError('unknown seat')

    if payload['tp'] < 1:
        raise TicketError('target points must be positive')

    try:
        # Normalised here so that everything downstream can treat `sub` as a well-formed id.
        payload['sub'] = str(uuid.UUID(payload['sub']))
    except (AttributeError, TypeError, ValueError):
        raise TicketError('subject is not a uuid') from None

    # `max_age` above already enforces the age of the signature. The `exp` claim is enforced
    # separately and deliberately redundantly, so that changing one does not silently remove the
    # other.
    expires_at = payload.get('exp')
    if isinstance(expires_at, bool) or not isinstance(expires_at, int):
        raise TicketError('missing expiry')
    if expires_at <= int(time.time()):
        raise TicketError('ticket has expired')

    return payload


def result_signature_base(raw_body, timestamp, nonce):
    """
    Return the bytes that a result signature commits to.

    The body enters as its SHA-256 digest rather than verbatim, so the base string stays short and
    binary-safe while still binding the signature to the exact bytes the receiver will parse. This
    is the mirror of `gamelink.signing.result_signature_base` on the tournaments side and must not
    drift from it.
    """
    digest = hashlib.sha256(_as_bytes(raw_body)).hexdigest()
    return f'{RESULT_SIGNATURE_VERSION}:{timestamp}:{nonce}:{digest}'.encode()


def sign_result_body(raw_body, timestamp, nonce):
    """
    Return the `X-Gamelink-Signature` header value for an outbound result.

    This server is the signer and holds exactly one result secret; the receiver holds a *list* and
    tries them all, which is what makes a rotation possible without a window where valid results
    bounce. Rotating is therefore: add the new secret to the receiver's list, deploy, switch this
    one, deploy, drop the old entry.
    """
    secret = getattr(settings, 'GAMELINK_RESULT_SECRET', '')
    if not secret:
        raise ImproperlyConfigured('GAMELINK_RESULT_SECRET is not configured')
    signature = hmac.new(secret.encode(), result_signature_base(raw_body, timestamp, nonce), hashlib.sha256)
    return f'{RESULT_SIGNATURE_VERSION}={signature.hexdigest()}'


def _as_bytes(value):
    return value if isinstance(value, bytes) else str(value).encode()


def redact(text):
    """
    Blank out ticket tokens and signatures in `text` so that it is safe to log.
    """
    if text is None:
        return text
    text = str(text)
    for pattern in _REDACTION_PATTERNS:
        text = pattern.sub(r'\1[redacted]', text)
    return text
