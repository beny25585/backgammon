from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0012_rename_tournament_target_points')]

    operations = [
        migrations.AlterField(
            model_name='task', name='status',
            field=models.CharField(
                max_length=10, default='pending',
                choices=[('pending', 'Pending'), ('running', 'Running'),
                         ('done', 'Done'), ('failed', 'Failed'),
                         ('blocked', 'Blocked — needs attention')],
            ),
        ),
    ]
