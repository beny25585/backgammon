"""
URL patterns of the tournament link.

Included under `api/` from the project root, so `enter/` here is `api/link/enter/` — the path the
tournaments server redirects to.
"""
from django.urls import path

from . import views
from .practice import enter_practice, prepare_practice

urlpatterns = [
    path('practice/prepare/', prepare_practice, name='link_practice_prepare'),
    path('practice/', enter_practice, name='link_practice'),
    path('enter/', views.enter_link, name='link_enter'),
    path('admin-command/', views.admin_command, name='link_admin_command'),
]
