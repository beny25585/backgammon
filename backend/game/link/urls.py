"""
URL patterns of the tournament link.

Included under `api/` from the project root, so `enter/` here is `api/link/enter/` — the path the
tournaments server redirects to.
"""
from django.urls import path

from . import views

urlpatterns = [
    path('enter/', views.enter_link, name='link_enter'),
]
