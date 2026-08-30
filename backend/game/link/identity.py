"""
Mapping an issuer's players onto local users.

The one rule this module exists to enforce: a linked player is found by `(issuer, external_id)`
and **never** by username. Usernames collide across two independently registered user tables, and
matching on one would silently hand a stranger somebody else's account.
"""

import logging
import uuid

from django.contrib.auth.models import User

from game.models import Player

from .models import LinkedIdentity

logger = logging.getLogger(__name__)

USERNAME_PREFIX = 't_'


def resolve_user(issuer, external_id, display_name=''):
    """
    Return the local user behind `(issuer, external_id)`, creating it on first sight.

    The created account has an unusable password: it can only ever be entered through a ticket,
    never through the login form.
    """
    identity = LinkedIdentity.objects.filter(issuer=issuer, external_id=external_id).first()
    if identity is not None:
        return identity.user

    user = User.objects.create_user(username=_available_username(external_id))
    user.set_unusable_password()
    user.save(update_fields=['password'])

    Player.objects.get_or_create(user=user, defaults={'nickname': (display_name or '')[:30]})
    LinkedIdentity.objects.create(issuer=issuer, external_id=external_id, user=user)

    logger.info(f"link identity created: issuer={issuer} user={user.username} id={user.id}")
    return user


def _available_username(external_id):
    """
    Build a namespaced username that cannot collide with a locally registered one.

    The namespace is the `t_` prefix plus part of the issuer's opaque id, so the name carries no
    information about the person. A pre-existing account that happens to occupy the name — local
    or from another issuer — is stepped over rather than adopted, which is the whole point.
    """
    try:
        digest = uuid.UUID(str(external_id)).hex
    except (AttributeError, TypeError, ValueError):
        digest = uuid.uuid4().hex

    base = f"{USERNAME_PREFIX}{digest[:12]}"
    username = base
    suffix = 1
    while User.objects.filter(username=username).exists():
        username = f"{base}-{suffix}"
        suffix += 1
    return username
