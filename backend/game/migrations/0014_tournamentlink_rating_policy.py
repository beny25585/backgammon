from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0013_task_blocked_status')]

    operations = [
        migrations.AddField(
            model_name='tournamentlink', name='rating_policy',
            field=models.CharField(max_length=20, blank=True, default=''),
        ),
    ]
