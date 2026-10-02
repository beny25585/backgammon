from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import logging
import os
import time
import uuid

from django.core.asgi import get_asgi_application

os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE",
    "backgammon_project.settings",
)

django_asgi_app = get_asgi_application()
import game.routing



logger = logging.getLogger(__name__)


class WebSocketReceiveTimingMiddleware:
    """
    Quiet production diagnostics for WebSocket latency.

    Stores the raw receive timestamp on the ASGI event dict so
    GameConsumer.dispatch can measure queue/dispatch latency.
    No per-message logging; disconnect/connection logs are DEBUG only.
    Never logs message content, query strings, or tokens.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        connection_id = uuid.uuid4().hex[:8]
        path = scope.get("path", "")

        async def traced_receive():
            event = await receive()

            event_type = event.get("type")

            if event_type == "websocket.receive":
                event["_ws_raw_received_perf"] = time.perf_counter()
                event["_ws_raw_received_epoch_ms"] = int(time.time() * 1000)
                event["_ws_trace_connection_id"] = connection_id

            elif event_type == "websocket.disconnect":
                logger.debug(
                    "ASGI_WS_DISCONNECT "
                    "connection=%s path=%s epoch_ms=%s code=%s",
                    connection_id,
                    path,
                    int(time.time() * 1000),
                    event.get("code"),
                )

            return event

        logger.debug(
            "ASGI_WS_CONNECTION "
            "connection=%s path=%s epoch_ms=%s",
            connection_id,
            path,
            int(time.time() * 1000),
        )

        traced_scope = dict(scope)
        traced_scope["trace_connection_id"] = connection_id

        await self.app(
            traced_scope,
            traced_receive,
            send,
        )


websocket_application = WebSocketReceiveTimingMiddleware(
    AuthMiddlewareStack(
        URLRouter(
            game.routing.websocket_urlpatterns
        )
    )
)


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": websocket_application,
    }
)
