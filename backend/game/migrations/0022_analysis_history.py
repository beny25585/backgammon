from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0021_task_requested_run_at')]

    operations = [
        # Existing rooms have no trustworthy history watermark. Do not infer
        # completeness from the event rows that happen to remain in the database.
        migrations.AddField(
            model_name='gameroom', name='history_sequence',
            field=models.PositiveIntegerField(null=True),
        ),
        migrations.AlterField(
            model_name='gameroom', name='history_sequence',
            field=models.PositiveIntegerField(null=True, default=0),
        ),
        migrations.AddField(
            model_name='gameevent', name='history_sequence',
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='match', name='history_sequence',
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='task', name='delivery_payload',
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddConstraint(
            model_name='gameevent',
            constraint=models.UniqueConstraint(
                fields=('room', 'history_sequence'), name='unique_room_history_sequence'),
        ),
    ]
