from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Match


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


class MatchSerializer(serializers.ModelSerializer):
    whitePlayer = UserSerializer(source='white_player', read_only=True)
    blackPlayer = UserSerializer(source='black_player', read_only=True)

    class Meta:
        model = Match
        fields = ('id', 'created_at', 'duration_seconds', 'whitePlayer', 'blackPlayer',
                  'match_type', 'target_points', 'white_score', 'black_score', 'winner', 'games')
