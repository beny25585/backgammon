from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0020_task_identity_lease')]
    operations = [migrations.AddField(
        model_name='task', name='requested_run_at',
        field=models.DateTimeField(null=True, blank=True),
    )]
