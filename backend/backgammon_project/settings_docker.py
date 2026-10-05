"""Container settings; local Compose explicitly selects its HTTP development mode."""

import os

from django.core.exceptions import ImproperlyConfigured

from backgammon_project.settings import *

if DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured(
        "Docker requires an explicitly configured PostgreSQL database."
    )
DATABASES["default"]["CONN_MAX_AGE"] = 0
DATABASES["default"]["OPTIONS"] = {"connect_timeout": 5}
STATIC_ROOT = "/data/static"
LOGGING["handlers"].pop("file", None)
for logger in LOGGING["loggers"].values():
    logger["handlers"] = ["console"]
    logger["level"] = os.environ.get("APP_LOG_LEVEL", "INFO")
LOGGING["root"] = {
    "handlers": ["console"],
    "level": os.environ.get("APP_LOG_LEVEL", "INFO"),
}
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    CSRF_TRUSTED_ORIGINS = os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    MIDDLEWARE = [*MIDDLEWARE, "django.middleware.clickjacking.XFrameOptionsMiddleware"]
