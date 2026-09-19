from django.urls import re_path
from game.ai_consumer import PracticeGameConsumer

websocket_urlpatterns = [
    re_path(r'^ws/game/(?P<room_id>[^/]+)/$', PracticeGameConsumer.as_asgi()),  # type: ignore[arg-type]
]
