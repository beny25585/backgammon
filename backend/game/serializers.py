from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Match, Player


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=4)
    password2 = serializers.CharField(write_only=True, min_length=4)

    class Meta:
        model = User
        fields = ('id', 'username', 'password', 'password2')

    def validate(self, data):
        if data['password'] != data['password2']:
            raise serializers.ValidationError({"password2": "Passwords do not match"})
        if User.objects.filter(username=data['username']).exists():
            raise serializers.ValidationError({"username": "Username already taken"})
        return data

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            password=validated_data['password']
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username')


class PlayerSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)

    class Meta:
        model = Player
        fields = ('id', 'user_id', 'username', 'nickname', 'rating', 'wins', 'losses', 'win_streak')


class MatchSerializer(serializers.ModelSerializer):
    whitePlayer = PlayerSerializer(source='white_player', read_only=True)
    blackPlayer = PlayerSerializer(source='black_player', read_only=True)

    class Meta:
        model = Match
        fields = ('id', 'created_at', 'duration_seconds', 'whitePlayer', 'blackPlayer',
                  'match_type', 'target_points', 'white_score', 'black_score', 'winner', 'games',
                  'end_reason', 'first_player', 'opening_roll', 'final_cube', 'hits',
                  'doubles_offered', 'doubles_accepted', 'clock_remaining')


class LocalMatchSerializer(serializers.Serializer):
    """Browser-authored history; online records are written by finalization only."""

    match_type = serializers.ChoiceField(choices=('local', 'ai'))
    owner_color = serializers.ChoiceField(choices=('white', 'black'), default='white')
    target_points = serializers.IntegerField(min_value=1, default=7)
    white_score = serializers.IntegerField(min_value=0, default=0)
    black_score = serializers.IntegerField(min_value=0, default=0)
    winner = serializers.ChoiceField(choices=('white', 'black'), allow_null=True, default=None)
    games = serializers.ListField(child=serializers.DictField(), default=list)
    duration_seconds = serializers.IntegerField(min_value=0, allow_null=True, default=None)

    def validate_games(self, games):
        for game in games:
            if 'transcript' in game and not isinstance(game['transcript'], list):
                raise serializers.ValidationError('Game transcripts must be lists.')
        return games
