from django.db import migrations, models


def consolidate_checks(apps, schema_editor):
    Task = apps.get_model('game', 'Task')
    names = {
        'game.inactivity.check_room_inactivity': 'inactivity',
        'game.presence.check_room_presence': 'presence',
        'game.inactivity.check_inactivity_watchdog': 'inactivity-watchdog',
    }
    seen = set()
    for task in Task.objects.using(schema_editor.connection.alias).filter(
            name__in=names, status__in=('pending', 'running')).order_by('run_at', 'created_at').iterator():
        prefix = names[task.name]
        if prefix != 'inactivity-watchdog' and not task.args:
            continue
        key = prefix if prefix == 'inactivity-watchdog' else f'{prefix}:{task.args[0]}'
        if key in seen:
            # Keep history and arguments. Only redundant monitoring/check tasks
            # retire here; results, wallet work and delivery events are untouched.
            task.status = 'done'
            task.last_error = None
            task.save(update_fields=['status', 'last_error'])
        else:
            task.key = key
            task.status = 'pending'
            task.save(update_fields=['key', 'status'])
            seen.add(key)


class Migration(migrations.Migration):
    dependencies = [('game', '0019_tournamentlink_status_events')]
    operations = [
        migrations.AddField(model_name='task', name='key',
                            field=models.CharField(max_length=255, null=True, blank=True, unique=True)),
        migrations.AddField(model_name='task', name='lease_token',
                            field=models.UUIDField(null=True, blank=True)),
        migrations.RunPython(consolidate_checks, migrations.RunPython.noop),
    ]
