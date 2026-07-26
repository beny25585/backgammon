from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView
from . import views

urlpatterns = [
    path('health/', views.health, name='health'),
    path('register/', views.register, name='register'),
    path('login/', TokenObtainPairView.as_view(), name='login'),
    path('rooms/', views.create_room, name='create_room'),
    path('rooms/join/', views.join_room, name='join_room'),
    path('rooms/cancel/', views.cancel_room, name='cancel_room'),
    path('rooms/<str:code>/', views.room_detail, name='room_detail'),
]
