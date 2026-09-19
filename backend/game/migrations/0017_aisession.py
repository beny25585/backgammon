from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('game', '0016_gameevent_game_id')]
    operations = [migrations.CreateModel(name='AiSession', fields=[
        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
        ('difficulty', models.CharField(default='hard', max_length=10)),
        ('target_board', models.JSONField(blank=True, null=True)),
        ('lease_token', models.CharField(blank=True, default='', max_length=36)),
        ('lease_until', models.DateTimeField(blank=True, null=True)),
        ('room', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='ai_session', to='game.gameroom')),
    ])]
