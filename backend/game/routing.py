from django.urls import re_path
from game.ai_consumer import PracticeGameConsumer
from game.spectator_consumer import SpectatorConsumer

websocket_urlpatterns = [
    re_path(r'^ws/game/(?P<room_id>[^/]+)/$', PracticeGameConsumer.as_asgi()),  # type: ignore[arg-type]
    re_path(r'^ws/watch/(?P<room_id>[^/]+)/$', SpectatorConsumer.as_asgi()),  # type: ignore[arg-type]
]
