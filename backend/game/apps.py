from django.apps import AppConfig

class GameConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'game'

    def ready(self):
        from .link import checks  # noqa: F401  (registers the boot-time configuration guard)
