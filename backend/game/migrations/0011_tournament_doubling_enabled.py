from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0010_merge_20260831_1213"),
    ]

    operations = [
        migrations.AddField(
            model_name="tournament",
            name="doubling_enabled",
            field=models.BooleanField(default=True),
        ),
    ]
