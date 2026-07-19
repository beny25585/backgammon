import uuid

from django.contrib.auth.models import User
from django.db import models as db_models
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .engine import BackgammonEngine
from .models import GameRoom
from .serializers import RegisterSerializer, UserSerializer


@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    return Response({'status': 'ok', 'message': 'Backgammon server is running'})


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    user = serializer.save()
    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserSerializer(user).data,
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def create_room(request):
    user = request.user
    active_rooms = GameRoom.objects.filter(
        db_models.Q(white_player=user) | db_models.Q(black_player=user),
        status__in=['waiting', 'playing']
    )
    if active_rooms.exists():
        return Response({'error': 'Already in a room'}, status=status.HTTP_400_BAD_REQUEST)

    target = request.data.get('targetPoints', 7)
    room = GameRoom.objects.create(
        white_player=user,
        code=uuid.uuid4().hex[:6].upper(),
        status='waiting',
        target_points=target,
        white_score=0,
        black_score=0,
    )
    initial = BackgammonEngine.get_initial_state()
    room.state = initial
    room.save()

    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': target,
        'whitePlayer': UserSerializer(user).data,
        'blackPlayer': None,
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def join_room(request):
    code = request.data.get('code', '').upper().strip()
    user = request.user
    try:
        room = GameRoom.objects.get(code=code, status='waiting')
    except GameRoom.DoesNotExist:
        return Response({'error': 'Room not found or already full'}, status=status.HTTP_404_NOT_FOUND)
    if room.black_player is not None:
        return Response({'error': 'Room is full'}, status=status.HTTP_400_BAD_REQUEST)
    if room.white_player == user:
        return Response({'error': 'You are already in this room'}, status=status.HTTP_400_BAD_REQUEST)
    room.black_player = user
    room.status = 'playing'
    room.save()
    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': room.target_points,
        'whitePlayer': UserSerializer(room.white_player).data,
        'blackPlayer': UserSerializer(user).data,
    })


@api_view(['GET'])
def room_detail(request, code):
    try:
        room = GameRoom.objects.get(code=code.upper())
    except GameRoom.DoesNotExist:
        return Response({'error': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': room.target_points,
        'whitePlayer': UserSerializer(room.white_player).data if room.white_player else None,
        'blackPlayer': UserSerializer(room.black_player).data if room.black_player else None,
        'state': room.state,
    })
