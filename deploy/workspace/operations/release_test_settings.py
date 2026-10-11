"""Settings for disposable release-check containers, never for live services."""
import importlib
import os

if os.environ.get('BACKGAMMON_RELEASE_TEST') != '1':
    raise RuntimeError('Release tests require an explicitly isolated runner')
if os.environ.get('DB_HOST') != 'release-postgres':
    raise RuntimeError('Release tests must use their disposable PostgreSQL service')

base = importlib.import_module(os.environ['RELEASE_BASE_SETTINGS'])
globals().update({name: getattr(base, name) for name in dir(base) if name.isupper()})
SECRET_KEY = 'release-test-only-key-not-a-production-credential-0123456789'
DEBUG = True
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
CORS_ALLOWED_ORIGINS = []
CSRF_TRUSTED_ORIGINS = []
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres',
    'USER': 'postgres', 'PASSWORD': 'disposable-release-tests',
    'HOST': 'release-postgres', 'PORT': '5432',
    'TEST': {'NAME': 'test_release'},
}}
CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
MEDIA_ROOT = '/tmp/release-media'
STATIC_ROOT = '/tmp/release-static'
GAMELINK_ENABLED = False
TRANZILA_ENABLED = False
TRANZILA_PURCHASES_ENABLED = False
ACCOUNT_EMAIL_ACTIONS_ENABLED = False
WEB_PUSH_PUBLIC_KEY = WEB_PUSH_PRIVATE_KEY = WEB_PUSH_SUBJECT = ''
ANALYSIS_API_TOKEN = 'disposable-release-tests'
import django
if django.VERSION >= (6, 1):
    from django.conf import DEPRECATED_EMAIL_SETTINGS
    for name in DEPRECATED_EMAIL_SETTINGS:
        globals().pop(name, None)
    MAILERS = {'default': {'BACKEND': 'django.core.mail.backends.locmem.EmailBackend'}}
else:
    globals().pop('MAILERS', None)
    EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
