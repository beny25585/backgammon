from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0014_tournamentlink_rating_policy')]

    operations = [
        migrations.AddField(
            model_name='tournamentlink',
            name='result_response',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
