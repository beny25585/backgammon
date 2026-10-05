from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0018_aisession_purchase_id')]

    operations = [
        migrations.AddField(
            model_name='tournamentlink',
            name='status_event_revision',
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='tournamentlink',
            name='status_started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
