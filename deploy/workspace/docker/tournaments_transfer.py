"""Export a read-only SQLite snapshot and import it into an unused PostgreSQL database."""

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from decimal import Decimal
from itertools import chain
from pathlib import Path

from service_runtime import enter_service


def file_hash(path):
    with path.open("rb") as content:
        return hashlib.file_digest(content, "sha256").hexdigest()


def model_queryset(model):
    queryset = model._base_manager.all()
    # Each inherited table must be serialized as its own model. Downcasting a
    # Mode into Knockout would omit the parent and duplicate the child record.
    if hasattr(queryset, "non_polymorphic"):
        queryset = queryset.non_polymorphic()
    return queryset


def summarize(records, model):
    normalized = []
    money = defaultdict(Decimal)
    fields = set()
    for original in records:
        row = {"pk": str(original["pk"]), "fields": dict(original["fields"])}
        for name, value in row["fields"].items():
            field = model._meta.get_field(name)
            if field.get_internal_type() == "DecimalField" and value is not None:
                amount = Decimal(str(value))
                row["fields"][name] = format(amount.normalize(), "f")
                money[name] += amount
            elif field.many_to_many:
                row["fields"][name] = sorted(value, key=str)
        fields.update(row["fields"])
        normalized.append(row)
    normalized.sort(key=lambda row: row["pk"])
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()
    return {
        "count": len(normalized),
        "ids": [row["pk"] for row in normalized],
        "fields": sorted(fields),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "money_totals": {
            name: format(amount.normalize(), "f") for name, amount in money.items()
        },
    }


def export_snapshot(directory):
    from django.apps import apps
    from django.core import serializers
    from django.db import connection

    if connection.vendor != "sqlite":
        raise ValueError("Export requires a read-only SQLite snapshot.")
    covered_tables = {
        model._meta.db_table
        for model in apps.get_models(include_auto_created=True)
        if model._meta.managed and not model._meta.proxy
    } | {"django_migrations"}
    unknown_tables = set(connection.introspection.table_names()) - covered_tables
    if unknown_tables:
        raise ValueError(
            "Snapshot contains tables outside the Django export; inspect them first: "
            + ", ".join(sorted(unknown_tables))
        )
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    fixture = directory / "fixture.json"
    # No natural primary keys: user, wallet, polymorphic and content-type IDs stay intact.
    models = [
        model
        for model in apps.get_models()
        if model._meta.managed and not model._meta.proxy
    ]
    rows = chain.from_iterable(
        model_queryset(model).order_by("pk").iterator() for model in models
    )
    with fixture.open("w", encoding="utf-8") as output:
        serializers.serialize("json", rows, stream=output)
    fixture.chmod(0o600)
    records = json.loads(fixture.read_text())
    grouped = defaultdict(list)
    for record in records:
        grouped[record["model"]].append(record)
    model_summaries = {}
    for model in apps.get_models():
        if model._meta.managed and not model._meta.proxy:
            label = model._meta.label_lower
            if len(grouped[label]) != model_queryset(model).count():
                raise ValueError(f"Export omitted or duplicated records for {label}.")
            model_summaries[label] = summarize(grouped[label], model)
    with connection.cursor() as cursor:
        cursor.execute("SELECT app, name FROM django_migrations ORDER BY app, name")
        migrations = cursor.fetchall()
    manifest = {
        "format": 1,
        "fixture_sha256": file_hash(fixture),
        "source_vendor": "sqlite",
        "migrations": migrations,
        "models": model_summaries,
    }
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    path.chmod(0o600)
    print(
        f"Exported {len(records)} records from the snapshot. IDs and monetary values are preserved."
    )


def read_bundle(directory):
    fixture = directory / "fixture.json"
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("format") != 1 or manifest.get("source_vendor") != "sqlite":
        raise ValueError("Unsupported transfer manifest.")
    if file_hash(fixture) != manifest["fixture_sha256"]:
        raise ValueError("Fixture checksum does not match the export manifest.")
    return fixture, manifest


def verify_manifest(manifest):
    from django.apps import apps
    from django.core import serializers

    for label, expected in manifest["models"].items():
        model = apps.get_model(label)
        queryset = model_queryset(model)
        if label in {"contenttypes.contenttype", "auth.permission"}:
            # A newer target version may add generated metadata. Imported rows
            # still retain their original IDs and values; business counts stay exact.
            queryset = queryset.filter(pk__in=expected["ids"])
        records = json.loads(
            serializers.serialize(
                "json",
                queryset.order_by("pk"),
                fields=expected["fields"],
            )
        )
        actual = summarize(records, model)
        if any(
            actual[key] != expected[key] for key in ("count", "sha256", "money_totals")
        ):
            raise ValueError(
                f"Transfer verification failed for {label}; transaction will not commit."
            )
    print(
        "All exported model counts, IDs, fields, relations and monetary totals match."
    )


def require_seed_catalog():
    """Allow exactly the untouched catalog created by billing migration 0005."""
    from django.apps import apps

    products = list(apps.get_model("billing", "StoreProduct").objects.values())
    if not products:
        return
    capabilities = {
        "online_play": True,
        "tournaments": True,
        "weekly_cup": True,
        "monthly_cup": True,
        "grand_championship": True,
        "rating": "basic",
        "pr": "none",
        "analysis": "none",
        "courses": "none",
        "live_lessons": False,
        "ai": "limited",
        "vip_benefits": False,
    }
    overrides = {
        "FREE": {},
        "GOLD": {
            "rating": "full",
            "pr": "basic",
            "analysis": "basic",
            "courses": "partial",
            "ai": "more",
        },
        "PREMIUM": {
            "pr": "advanced",
            "analysis": "full",
            "courses": "full",
            "live_lessons": True,
            "ai": "unlimited",
        },
        "VIP": {"pr": "full", "vip_benefits": True},
    }
    expected = {}
    for tier, changes in overrides.items():
        capabilities = {**capabilities, **changes}
        expected[tier] = {
            "name": tier.title(),
            "kind": "subscription",
            "tier": tier,
            "price": Decimal("0.00"),
            "currency": "ILS",
            "coin_quantity": 0,
            "period_months": 1,
            "active": tier == "FREE",
            "capabilities": capabilities,
            "version": 1,
        }
    actual = {
        product["tier"]: {
            key: value
            for key, value in product.items()
            if key not in {"id", "updated_at"}
        }
        for product in products
    }
    if len(products) != 4 or actual != expected:
        raise ValueError("Target contains a changed store catalog; import refused.")


def import_bundle(directory, confirmed_name):
    from django.apps import apps
    from django.contrib.contenttypes.models import ContentType
    from django.core.management import call_command
    from django.db import connection, transaction
    from django.db.migrations.executor import MigrationExecutor

    if (
        connection.vendor != "postgresql"
        or str(connection.settings_dict["NAME"]) != confirmed_name
    ):
        raise ValueError(
            "Import requires PostgreSQL and an exact --confirm-new-database name."
        )
    fixture, manifest = read_bundle(directory)
    executor = MigrationExecutor(connection)
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        raise ValueError("Apply target migrations before importing.")
    unknown = set(map(tuple, manifest["migrations"])) - set(
        executor.loader.disk_migrations
    )
    if unknown:
        raise ValueError(
            "The target code does not contain every source migration; reconcile code first."
        )
    for label in manifest["models"]:
        apps.get_model(label)
    # Only migration-generated metadata, the unchanged catalog and known Task seed
    # are allowed. An account, session, payment or game in the target blocks import.
    with transaction.atomic():
        tables = sorted(
            table
            for table in connection.introspection.table_names()
            if table != "django_migrations"
        )
        quoted = ", ".join(connection.ops.quote_name(table) for table in tables)
        with connection.cursor() as cursor:
            cursor.execute(f"LOCK TABLE {quoted} IN ACCESS EXCLUSIVE MODE")
            for table in tables:
                if table in {"auth_permission", "django_content_type"}:
                    continue
                if table == "billing_storeproduct":
                    require_seed_catalog()
                    continue
                if table == "frontend_task":
                    # Use the ORM so JSONField values have the same Python type
                    # regardless of the PostgreSQL driver used by the target.
                    tasks = apps.get_model("frontend", "Task").objects.values_list(
                        "key",
                        "name",
                        "status",
                        "attempts",
                        "kwargs",
                        "lease_token",
                        "locked_until",
                        "last_error",
                        "last_finished_at",
                    )
                    if any(
                        row
                        != (
                            "expire-unstarted-games",
                            "expire_unstarted_games",
                            "pending",
                            0,
                            {},
                            None,
                            None,
                            "",
                            None,
                        )
                        for row in tasks
                    ):
                        raise ValueError(
                            "Target contains non-seed tasks; import refused."
                        )
                else:
                    cursor.execute(
                        f"SELECT EXISTS(SELECT 1 FROM {connection.ops.quote_name(table)})"
                    )
                    if cursor.fetchone()[0]:
                        raise ValueError(
                            f"Target table {table} contains data; import refused."
                        )
            cursor.execute(f"TRUNCATE TABLE {quoted} RESTART IDENTITY")
        ContentType.objects.clear_cache()
        call_command("loaddata", str(fixture), verbosity=0)
        ContentType.objects.clear_cache()
        # With every schema migration already applied, this only emits the
        # normal post-migrate hooks to create metadata for newly added models.
        call_command("migrate", interactive=False, verbosity=0)
        verify_manifest(manifest)
        connection.check_constraints()
    print("Import committed. Django restored sequences for the fixture models.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("export", "import", "verify"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--sqlite", type=Path)
    parser.add_argument("--service")
    parser.add_argument("--confirm-new-database")
    args = parser.parse_args()
    # Resolve before switching to the service working directory.
    directory = args.directory.resolve()
    if args.service:
        if not args.directory.is_absolute() or (
            args.sqlite and not args.sqlite.is_absolute()
        ):
            raise ValueError("Use absolute paths when entering a service environment.")
        enter_service(args.service)
    sys.path.insert(0, os.getcwd())
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tournaments.settings.docker")
    import django
    from django.conf import settings

    if args.action == "export":
        if not args.sqlite or not args.sqlite.resolve().is_file():
            raise ValueError("Export requires --sqlite pointing to a backup snapshot.")
        default = dict(settings.DATABASES["default"])
        original = Path(default["NAME"]).resolve()
        snapshot = args.sqlite.resolve()
        if snapshot == original:
            raise ValueError(
                "Export must read a backup snapshot, not the live database."
            )
        default.update(
            ENGINE="django.db.backends.sqlite3",
            NAME=f"{snapshot.as_uri()}?mode=ro",
            OPTIONS={"uri": True},
        )
        settings.DATABASES = {"default": default}
    django.setup()
    if args.action == "export":
        export_snapshot(directory)
    elif args.action == "import":
        if not args.confirm_new_database:
            raise ValueError("Specify the exact unused target database name.")
        import_bundle(directory, args.confirm_new_database)
    else:
        _, manifest = read_bundle(directory)
        verify_manifest(manifest)


if __name__ == "__main__":
    main()
