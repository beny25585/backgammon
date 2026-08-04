from django.db import migrations, models
import uuid

class Migration(migrations.Migration):

    dependencies = [
        ('game', '0005_alter_gameroom_time_control'),
    ]

    operations = [
        migrations.CreateModel(
            name='Task',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ('name', models.CharField(max_length=200, help_text='Callable path, e.g. module.func')),
                ('args', models.JSONField(default=list, blank=True)),
                ('kwargs', models.JSONField(default=dict, blank=True)),
                ('run_at', models.DateTimeField(blank=True, help_text='When to run (UTC)', null=True)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('running', 'Running'), ('done', 'Done'), ('failed', 'Failed')], default='pending', max_length=10)),
                ('attempts', models.IntegerField(default=0)),
                ('max_attempts', models.IntegerField(default=3)),
                ('last_error', models.TextField(blank=True, null=True)),
                ('result', models.JSONField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-run_at', '-created_at'],
            },
        ),
    ]
