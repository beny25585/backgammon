import os
import sys
from pathlib import Path
from decouple import config
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY')

DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='').split(',')

INSTALLED_APPS = [
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'daphne',
    'django.contrib.admin',
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.staticfiles',
    'django.contrib.messages',
    'channels',
    'game',
    'Tournaments'
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware', 
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]

ROOT_URLCONF = 'backgammon_project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backgammon_project.wsgi.application'
ASGI_APPLICATION = 'backgammon_project.asgi.application'

DATABASES = {
    'default': dj_database_url.parse(config('DATABASE_URL', default='sqlite:///db.sqlite3'))

}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/backgammon/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CHANNEL_LAYER_BACKEND = config('CHANNEL_LAYER_BACKEND', default='redis')

# Channels settings
if CHANNEL_LAYER_BACKEND == 'memory':
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [config('REDIS_URL', default='redis://127.0.0.1:6379/0')],
                'capacity': 150,
                'expiry': 60,
            },
        },
    }

# Tests run each async test in a fresh event loop; the Redis layer is a
# process-wide singleton whose per-channel asyncio locks leak across loops and
# crash with "bound to a different event loop". Use the in-memory layer instead.
if 'test' in sys.argv:
    CHANNEL_LAYERS['default'] = {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    }

# CORS settings
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default='').split(',')

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

from datetime import timedelta
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'TOKEN_OBTAIN_SERIALIZER': 'game.token_serializer.CustomTokenObtainPairSerializer',
}

# Tournament link (see tournaments-backgammon-messaging.md §5). Ships disabled; every secret
# defaults to empty, and `game.link.checks` refuses to boot a configured-but-weak production.
GAMELINK_ENABLED = config('GAMELINK_ENABLED', default=False, cast=bool)
GAMELINK_ISSUER = 'backgammon'
GAMELINK_ACCEPTED_ISSUERS = ['tournaments']
GAMELINK_TOURNAMENTS_URL = config('GAMELINK_TOURNAMENTS_URL', default='')
GAMELINK_TOURNAMENTS_FRONTEND_URL = config(
    'GAMELINK_TOURNAMENTS_FRONTEND_URL',
    default=GAMELINK_TOURNAMENTS_URL,
)
GAMELINK_FRONTEND_URL = config('GAMELINK_FRONTEND_URL', default='')
# Verifier takes a list and signer uses the first, so secrets rotate without downtime.
GAMELINK_TICKET_SECRETS = [s for s in config('GAMELINK_TICKET_SECRETS', default='').split(',') if s]
GAMELINK_RESULT_SECRET = config('GAMELINK_RESULT_SECRET', default='')
# Must match the issuer's GAMELINK_TICKET_TTL; a ticket older than this is refused.
GAMELINK_TICKET_TTL = 120
# Deliberately not the 24 h SIMPLE_JWT default: a linked session is scoped to the match.
GAMELINK_LINK_TOKEN_TTL = timedelta(hours=2)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'file': {
            'level': 'DEBUG',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'django.log',
            'formatter': 'verbose',
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file', 'console'],
            'level': 'INFO',
            'propagate': False,
        },
        'game': {
            'handlers': ['file', 'console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}
