from django.urls import path, include

urlpatterns = [
    path('api/link/', include('game.link.urls')),
    path('api/', include('game.urls')),
]
