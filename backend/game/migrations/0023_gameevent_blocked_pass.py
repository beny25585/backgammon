from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('game', '0022_analysis_history')]

    operations = [
        migrations.AlterField(
            model_name='gameevent', name='event_type',
            field=models.CharField(max_length=20, choices=[
                ('roll', 'Roll'),
                ('blocked_pass', 'Blocked bar pass'),
                ('move', 'Move'),
                ('undo', 'Undo'),
                ('end_turn', 'End turn'),
                ('double', 'Double'),
                ('double_response', 'Double response'),
                ('resign', 'Resign'),
                ('next_game', 'Next game'),
                ('reorder_dice', 'Reorder dice'),
                ('opening_result_done', 'Opening result done'),
            ]),
        ),
    ]
