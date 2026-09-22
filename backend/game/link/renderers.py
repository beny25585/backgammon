"""Player-facing entry failures must never expose the browsable API UI."""
from django.template.loader import render_to_string
from rest_framework.renderers import BaseRenderer


class EntryHTMLRenderer(BaseRenderer):
    media_type = 'text/html'
    format = 'html'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if renderer_context:
            renderer_context['response']['Cache-Control'] = 'no-store'
            renderer_context['response']['Referrer-Policy'] = 'no-referrer'
        from .views import tournaments_frontend_url
        from django.core.exceptions import ImproperlyConfigured
        try:
            home = tournaments_frontend_url()
        except ImproperlyConfigured:
            home = '/tournaments/'
        return render_to_string('game/link_error.html', {'home': home})
