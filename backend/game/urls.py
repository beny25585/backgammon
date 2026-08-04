from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView
from . import views

urlpatterns = [
    path('health/', views.health, name='health'),
    path('client-log/', views.client_log, name='client_log'),
    path('register/', views.register, name='register'),
    path('login/', TokenObtainPairView.as_view(), name='login'),
    path('rooms/', views.create_room, name='create_room'),
    path('rooms/join/', views.join_room, name='join_room'),
    path('rooms/active/', views.active_room, name='active_room'),
    path('rooms/cancel/', views.cancel_room, name='cancel_room'),
    path('rooms/<str:code>/', views.room_detail, name='room_detail'),
    path('matches/', views.save_match, name='save_match'),
    path('matches/list/', views.list_matches, name='list_matches'),
    path('matches/<uuid:pk>/', views.match_detail, name='match_detail'),
    path('stats/', views.player_stats, name='player_stats'),
]
