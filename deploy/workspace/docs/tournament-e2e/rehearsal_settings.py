"""Original Docker settings plus passive diagnostics on fresh rehearsal DBs."""
import importlib
import os

from rehearsal_entry import KINDS, session, validate_settings

_kind = os.environ.get('E2E_ADMISSION_KIND')
if _kind not in KINDS:
    raise ValueError('An explicit rehearsal entry service is required')
_original = importlib.import_module(KINDS[_kind])
globals().update({key: value for key, value in vars(_original).items() if key.isupper()})
validate_settings(session(), _kind, _original.DATABASES['default'], os.environ.get('REDIS_URL'))
MIDDLEWARE = ['rehearsal_entry.AdmissionMiddleware', *_original.MIDDLEWARE]
if session().get('load_cleanup_version') == 1 and _kind == 'tournaments':
    MIDDLEWARE = ['load_cleanup.LoadCallbackReceiptMiddleware', *MIDDLEWARE]
