"""
Boot-time configuration guard.

The failure modes this catches are all silent ones: an unset secret still lets `signing.loads`
run and simply reject everything, an `http://` base URL still redirects, and a ticket secret
reused as the result secret still works. So when the feature is on outside `DEBUG`, refuse to
boot rather than degrade into something that looks fine and is not.

Registered from `game.apps.GameConfig.ready`, under the `security` tag.
"""

from django.conf import settings
from django.core.checks import Error, Tags, register

MINIMUM_SECRET_LENGTH = 32


@register(Tags.security)
def check_gamelink_configuration(app_configs, **kwargs):
    if not settings.GAMELINK_ENABLED or settings.DEBUG:
        return []

    errors = []
    ticket_secrets = [secret for secret in settings.GAMELINK_TICKET_SECRETS if secret]
    result_secret = settings.GAMELINK_RESULT_SECRET

    if not ticket_secrets or not all(_strong(secret) for secret in ticket_secrets):
        errors.append(Error(
            'GAMELINK_TICKET_SECRETS is empty or contains a secret that is too short.',
            hint=f'Every entry must be at least {MINIMUM_SECRET_LENGTH} characters. During '
                 'rotation the list holds both the old and the new secret; the issuer signs with '
                 'the first entry of its own list.',
            id='gamelink.E001',
        ))

    if not _strong(result_secret):
        errors.append(Error(
            'GAMELINK_RESULT_SECRET is missing or too short.',
            hint=f'Set it from the environment to at least {MINIMUM_SECRET_LENGTH} characters. '
                 'It is a different secret from the ticket secrets on purpose.',
            id='gamelink.E002',
        ))

    if result_secret and result_secret in ticket_secrets:
        errors.append(Error(
            'GAMELINK_RESULT_SECRET is also a ticket secret.',
            hint='The two channels are separately keyed so that compromise of the key that lets '
                 'someone start a game does not also let them report its result.',
            id='gamelink.E003',
        ))

    if settings.SECRET_KEY in ticket_secrets or settings.SECRET_KEY == result_secret:
        errors.append(Error(
            'A gamelink secret is the same as SECRET_KEY.',
            hint='SECRET_KEY signs sessions and password resets. Generate separate values with '
                 'python -c "import secrets; print(secrets.token_urlsafe(48))".',
            id='gamelink.E004',
        ))

    if not _https(settings.GAMELINK_TOURNAMENTS_URL):
        errors.append(Error(
            'GAMELINK_TOURNAMENTS_URL is not an https:// URL.',
            hint='Results are posted to it carrying a signed body; plain http would expose them '
                 'to tampering in transit.',
            id='gamelink.E005',
        ))

    if not _https(settings.GAMELINK_FRONTEND_URL):
        errors.append(Error(
            'GAMELINK_FRONTEND_URL is not an https:// URL.',
            hint='Redemption redirects to it with session tokens in the URL fragment; plain http '
                 'would put them on the wire.',
            id='gamelink.E006',
        ))

    return errors


def _strong(secret):
    return bool(secret) and len(secret) >= MINIMUM_SECRET_LENGTH


def _https(url):
    return bool(url) and url.startswith('https://')
