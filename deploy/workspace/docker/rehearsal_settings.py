"""Settings exclusively for synthetic, isolated data-transfer rehearsals."""

import os

if os.environ.get("RUN_TRANSFER_REHEARSAL") != "1":
    raise RuntimeError("Rehearsal settings require an explicit isolated runner.")

if os.environ["REHEARSAL_KIND"] == "game":
    from backgammon_project.settings_docker import *
else:
    from tournaments.settings.common import *

SECRET_KEY = os.environ["SECRET_KEY"]
DEBUG = False
ALLOWED_HOSTS = ["localhost"]
CORS_ALLOWED_ORIGINS = []
CSRF_TRUSTED_ORIGINS = []
GAMELINK_ENABLED = False
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
EMAIL_BACKEND = "django.core.mail.backends.dummy.EmailBackend"
TRANZILA_ENABLED = False
TRANZILA_PURCHASES_ENABLED = False
if os.environ.get("REHEARSAL_SQLITE") == "1":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": "/work/source.sqlite3",
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["DB_NAME"],
            "USER": os.environ["DB_USER"],
            "PASSWORD": os.environ["DB_PASSWORD"],
            "HOST": "postgres",
            "PORT": "5432",
            "CONN_MAX_AGE": 0,
        }
    }
