from django.apps import AppConfig


class GameConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'game'

    def import_models(self):
        super().import_models()
        # These models belong to game but live outside its default models module.
        from .link import models  # noqa: F401

    def ready(self):
        from .link import checks  # noqa: F401  (registers the boot-time configuration guard)
