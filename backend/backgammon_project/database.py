"""Parse an explicitly configured PostgreSQL database without a local fallback."""
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured


def postgresql_database(url):
    if not isinstance(url, str) or not url.strip():
        raise ImproperlyConfigured('DATABASE_URL is required and must identify a PostgreSQL database.')
    try:
        if urlsplit(url).scheme.lower() not in ('postgres', 'postgresql', 'pgsql'):
            raise ValueError()
        database = dj_database_url.parse(url, conn_max_age=0)
        if database.get('ENGINE') != 'django.db.backends.postgresql' or not database.get('NAME'):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        # Do not include a credential-bearing URL in startup errors.
        raise ImproperlyConfigured('DATABASE_URL must be a valid PostgreSQL URL; SQLite and other backends are unsupported.') from None
    database.setdefault('OPTIONS', {}).setdefault('connect_timeout', 5)
    return database
