"""Seed synthetic records or audit a rehearsal database; never use live settings."""

# Django must be initialized before model imports in this standalone script.

import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path

if os.environ.get("RUN_TRANSFER_REHEARSAL") != "1":
    raise RuntimeError("Synthetic rehearsal runner required.")

import django

django.setup()

from django.apps import apps
from django.contrib.auth.models import Group, Permission, User
from django.core.management.color import no_style
from django.db import connection, transaction
from django.utils import timezone
from tournaments_transfer import model_queryset, serialize_records, summarize


def seed():
    if User.objects.exists():
        raise ValueError("Synthetic seed requires a fresh rehearsal database.")
    User.objects.bulk_create(
        [User(id=11, username="rehearsal_one"), User(id=27, username="rehearsal_two")]
    )
    group = Group.objects.create(name="synthetic_rehearsal")
    group.permissions.add(Permission.objects.order_by("pk").first())
    User.objects.get(pk=11).groups.add(group)
    from django.contrib.sessions.models import Session

    for index, microseconds in enumerate((500, 123456)):
        Session.objects.create(
            session_key=f"synthetic_timestamp_{index}",
            session_data=f"synthetic_payload_{index}",
            expire_date=datetime(
                2030,
                10,
                17,
                13,
                13,
                9,
                microsecond=microseconds,
                tzinfo=datetime_timezone.utc,
            ),
        )
    if os.environ["REHEARSAL_KIND"] == "game":
        from game.models import GameRoom, GameState, Match, Player, RoomPlayer

        players = [
            Player.objects.create(user_id=pk, nickname=f"player_{pk}")
            for pk in (11, 27)
        ]
        room = GameRoom.objects.create(
            code="RH0001", status="finished", state={"dice": [2, 5]}
        )
        for player, color in zip(players, ("white", "black")):
            RoomPlayer.objects.create(room=room, player=player, color=color)
        GameState.objects.create(
            room=room, state_data={"turn": "white", "points": [1, 2]}
        )
        Match.objects.create(
            room=room,
            white_player=players[0],
            black_player=players[1],
            white_score=7,
            black_score=3,
            winner="white",
            games=[{"score": [7, 3]}],
        )
        with connection.cursor() as cursor:
            for statement in connection.ops.sequence_reset_sql(no_style(), [User]):
                cursor.execute(statement)
    else:
        from frontend.models import Task
        from tournaments.models import (
            Fixture,
            Knockout,
            Participant,
            Participation,
            Tournament,
            WalletTransaction,
        )

        tournament = Tournament.objects.create(
            name="Synthetic rehearsal",
            podium_spec=[1],
            starts_at=timezone.now(),
            entry_fee="12.50",
            prize_money="100.25",
            creator_id=11,
        )
        participants = [
            Participant.objects.create(user_id=pk, name=f"player_{pk}")
            for pk in (11, 27)
        ]
        for slot, participant in enumerate(participants):
            Participation.objects.create(
                tournament=tournament, participant=participant, slot_id=slot
            )
        mode = Knockout.objects.create(
            tournament=tournament, identifier="synthetic", double_elimination=False
        )
        fixture = Fixture.objects.create(
            mode=mode, level=0, player1=participants[0], player2=participants[1]
        )
        fixture.confirmations.add(11, 27)
        for pk, amount in ((11, "1000.25"), (27, "875.50")):
            WalletTransaction.objects.create(
                user_id=pk, kind="deposit", amount=amount, balance_after=amount
            )
        Task.objects.create(
            key="synthetic-rehearsal-task",
            name="reconcile_searches",
            kwargs={"synthetic": True},
        )
    print(
        "Synthetic seed created: users, sessions with microseconds, relationships, game or tournament data."
    )


def audit(output):
    summaries = {}
    for model in apps.get_models():
        if model._meta.managed and not model._meta.proxy:
            records = json.loads(
                serialize_records(model_queryset(model).order_by("pk"))
            )
            summaries[model._meta.label_lower] = summarize(records, model)
    Path(output).write_text(json.dumps(summaries, sort_keys=True), encoding="utf-8")
    print("Rehearsal model audit saved.")


def check_sequence():
    maximum = User.objects.order_by("-pk").values_list("pk", flat=True).first()
    with transaction.atomic():
        created = User.objects.create(username="rehearsal_sequence_probe")
        if created.pk <= maximum:
            raise ValueError("User sequence did not advance past restored IDs.")
        transaction.set_rollback(True)
    print("Restored user sequence advances past the imported IDs.")


action = sys.argv[1]
if action == "seed":
    seed()
elif action == "audit":
    audit(sys.argv[2])
elif action == "sequence":
    check_sequence()
elif action == "snapshot":
    with (
        closing(
            sqlite3.connect("file:/work/source.sqlite3?mode=ro", uri=True)
        ) as source,
        closing(sqlite3.connect("/work/tournaments.snapshot.sqlite3")) as destination,
    ):
        source.backup(destination)
    print("Synthetic SQLite snapshot saved.")
else:
    raise ValueError("Unknown rehearsal operation.")
