from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0011_tournament_doubling_enabled"),
    ]

    operations = [
        migrations.RenameField(
            model_name="tournament",
            old_name="target_point",
            new_name="target_points",
        ),
        migrations.AlterField(
            model_name="tournamentsignup",
            name="player",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="tournament_signups",
                to="game.player",
            ),
        ),
    ]
