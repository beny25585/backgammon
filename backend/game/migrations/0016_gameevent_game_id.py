from django.db import migrations, models


def backfill_game_event_game_id(apps, schema_editor):
    GameEvent = apps.get_model('game', 'GameEvent')
    for event in GameEvent.objects.all().iterator():
        payload = event.payload if isinstance(event.payload, dict) else {}
        game_id = payload.get('gameId')
        if game_id:
            event.game_id = str(game_id)
        else:
            event.game_id = 'initial'
        event.save(update_fields=['game_id'])


class Migration(migrations.Migration):
    dependencies = [('game', '0015_tournamentlink_result_response')]

    operations = [
        migrations.AddField(
            model_name='gameevent',
            name='game_id',
            field=models.CharField(
                max_length=64,
                null=True,
                db_index=True,
            ),
        ),
        migrations.RunPython(
            backfill_game_event_game_id,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='gameevent',
            name='game_id',
            field=models.CharField(
                max_length=64,
                db_index=True,
            ),
        ),
        migrations.AlterField(
            model_name='gameevent',
            name='event_type',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('roll', 'Roll'),
                    ('move', 'Move'),
                    ('undo', 'Undo'),
                    ('end_turn', 'End turn'),
                    ('double', 'Double'),
                    ('double_response', 'Double response'),
                    ('resign', 'Resign'),
                    ('next_game', 'Next game'),
                    ('reorder_dice', 'Reorder dice'),
                    ('opening_result_done', 'Opening result done'),
                ],
            ),
        ),
        migrations.AddIndex(
            model_name='gameevent',
            index=models.Index(
                fields=['room', 'game_id', 'sequence'],
                name='game_event_game_seq_idx',
            ),
        ),
    ]
