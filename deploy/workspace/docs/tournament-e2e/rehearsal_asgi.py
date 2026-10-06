"""The pinned application with a guarded, passive entry observer."""
import importlib
import os

from rehearsal_entry import AdmissionASGI, install

_kind = os.environ.get('E2E_ADMISSION_KIND')
if os.environ.get('DJANGO_SETTINGS_MODULE') != 'rehearsal_settings' or _kind not in ('game', 'tournaments'):
    raise ValueError('Entry ASGI requires explicit rehearsal settings')
_module = 'backgammon_project.asgi' if _kind == 'game' else 'tournaments.asgi'
_application = importlib.import_module(_module).application
install()
application = AdmissionASGI(_application)
