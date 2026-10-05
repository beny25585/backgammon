"""Prepare/run explicitly disposable E2E services; never invoke on a real DB.

Examples (run later with the corresponding service's native Python):
  backend_bootstrap.py --run-dir ABSOLUTE_RUN_DIR init
  backend_bootstrap.py --run-dir ABSOLUTE_RUN_DIR --service tournament migrate
  backend_bootstrap.py --run-dir ABSOLUTE_RUN_DIR --service tournament seed-admin
  backend_bootstrap.py --run-dir ABSOLUTE_RUN_DIR --service game daphne
  backend_bootstrap.py --run-dir ABSOLUTE_RUN_DIR --service game manage run_tasks_worker --interval 1 --limit 20

This harness deliberately does not patch results, readiness, clocks, or task
outcomes. Tournament/player creation and play belong to the public API/browser
scenario. Only the initial administrator is seeded directly.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import uuid

sys.dont_write_bytecode = True

from e2e_common import (
    PORTS, WORKSPACE, SERVICE_ROOTS, guarded_run_dir, load_config, prepare_runtime,
    private_directory, require, write_private,
)


def initialize(run_dir):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    run = guarded_run_dir(run_dir)
    require(not run.exists(), "init requires a fresh run-dir; existing runs are never reset")
    private_directory(run)
    for name in ("db", "certificates", "logs", "media", "static", "artifacts"):
        (run / name).mkdir(mode=0o700)
    run_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Disposable tournament E2E {run_id}")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=7))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False,
                                      key_encipherment=False, data_encipherment=False, key_agreement=False,
                                      key_cert_sign=True, crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    server = (x509.CertificateBuilder().subject_name(server_name).issuer_name(ca_name)
              .public_key(server_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=7))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.SubjectAlternativeName([
                  x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                  x509.IPAddress(ipaddress.ip_address("::1")),
              ]), critical=False)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                                          key_encipherment=True, data_encipherment=False, key_agreement=False,
                                          key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
    certificate = {"ca": str(run / "certificates" / "ca.crt"),
                   "cert": str(run / "certificates" / "localhost.crt"),
                   "key": str(run / "certificates" / "localhost.key")}
    write_private(Path(certificate["ca"]), ca.public_bytes(serialization.Encoding.PEM))
    write_private(Path(certificate["cert"]), server.public_bytes(serialization.Encoding.PEM))
    write_private(Path(certificate["key"]), server_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    # The CA signing key is never persisted or installed in the OS trust store.
    config = {
        "E2E_DISPOSABLE": True, "workspace": str(WORKSPACE), "run_dir": str(run),
        "run_id": run_id, "created_at": now.isoformat(), "ports": PORTS,
        "urls": {"game": f"https://127.0.0.1:{PORTS['game_frontend']}",
                 "tournament": f"https://127.0.0.1:{PORTS['tournament_frontend']}"},
        "certificate": certificate,
        "databases": {service: str(run / "db" / f"{service}.sqlite3") for service in ("game", "tournament")},
        "secrets": {key: secrets.token_urlsafe(48) for key in ("ticket", "result", "command", "game_django", "tournament_django")},
        "admin": {"username": "E2EAdmin", "password": secrets.token_urlsafe(36)},
        "excluded_integrations": ["web-push", "email-delivery", "analysis", "AI", "payments"],
        "profile": os.environ.get("E2E_PROFILE", "local"),
        "player_count": int(os.environ.get("E2E_PLAYER_COUNT", "16")),
        "recovery_checks": os.environ.get("E2E_RECOVERY_CHECKS", "0") == "1",
        "source_roots": {key: str(value) for key, value in SERVICE_ROOTS.items()},
        "source_commits": {key: os.environ.get(f"E2E_{key.upper()}_COMMIT")
                           for key in ("game", "tournament", "ui")},
    }
    require(config["profile"] in ("local", "server-existing"), "unknown runtime profile")
    require(config['player_count'] in (16, 32), 'player count must be 16 or 32')
    mode = os.environ.get('E2E_DATABASE_MODE', 'sqlite')
    require(mode in ('sqlite', 'postgresql'), 'unknown database mode')
    config['database_mode'] = mode
    if mode == 'postgresql':
        from postgresql_runtime import provision
        provision(config)
    if config["profile"] == "server-existing":
        # Preserve the old game's deferred SQLite implementation for baseline.
        # Do not copy the new backend into the server checkout.
        config["sqlite_engines"] = {
            service: (f"{package}.db.backends.sqlite3"
                      if (root / package / "db/backends/sqlite3/base.py").is_file()
                      else "django.db.backends.sqlite3")
            for service, root, package in (
                ("game", SERVICE_ROOTS["game"], "game"),
                ("tournament", SERVICE_ROOTS["tournament"], "tournaments"),
            )
        }
    write_private(run / "config.json", json.dumps(config, indent=2) + "\n")
    load_config(run)
    print(json.dumps({"initialized": True, "run_dir": str(run), "config": str(run / "config.json"),
                      "database_files_created": False, "services_started": False}, indent=2))


def setup_django(config, service):
    import django
    django.setup()
    from django.conf import settings
    require(str(settings.DATABASES["default"]["NAME"]) == config["databases"][service], "Django database override failed")
    expected_engine = ('django.db.backends.postgresql' if config.get('database_mode') == 'postgresql'
        else config.get("sqlite_engines", {}).get(service,
        "game.db.backends.sqlite3" if service == "game" else "tournaments.db.backends.sqlite3"))
    require(settings.DATABASES["default"]["ENGINE"] == expected_engine, "database backend override failed")
    require(settings.DEBUG is False, "production configuration checks must remain active")
    require(settings.CHANNEL_LAYERS["default"]["BACKEND"] == "channels_redis.core.RedisChannelLayer",
            "cross-process E2E requires real Redis Channels")


def seed_admin(config, service):
    require(service == "tournament", "only the tournament bootstrap administrator is seeded")
    from django.contrib.auth import get_user_model
    from django.db import transaction
    User = get_user_model()
    with transaction.atomic():
        existing = User.objects.filter(username=config["admin"]["username"]).first()
        if existing is not None:
            require(existing.is_superuser and existing.is_staff and existing.is_active
                    and existing.check_password(config["admin"]["password"]),
                    "bootstrap account already exists with unexpected credentials or roles")
        else:
            require(not User.objects.exists(), "seed-admin is only allowed in a newly migrated database")
            User.objects.create_superuser(
                username=config["admin"]["username"], password=config["admin"]["password"],
                email="e2e-admin@example.invalid",
            )
    print(json.dumps({"administrator_ready": True, "created": existing is None}))


def replay_results(config, service):
    """Repeat real frozen signed results; never invent or mutate an outcome."""
    from urllib.parse import urlsplit
    import ssl
    import httpx
    from django.conf import settings
    from django.db import connection
    from game.link.models import TournamentLink
    from game.link.signing import sign_result_body

    require(service == 'game' and config['E2E_DISPOSABLE'] is True, 'Disposable game runtime required')
    base = settings.GAMELINK_TOURNAMENTS_URL.rstrip('/')
    require(base == config['urls']['tournament'] and urlsplit(base).hostname == '127.0.0.1',
            'Result replay refuses any destination outside this isolated run')
    bodies = list(TournamentLink.objects.filter(result_status='delivered')
                  .order_by('fixture_id').values_list('result_body', flat=True))
    expected_matches = config.get('player_count', 16) - 1
    require(len(bodies) == expected_matches and all(bodies),
            f'Replay requires {expected_matches} completed delivered results')
    connection.close()
    acknowledgements = []
    verify = ssl.create_default_context(cafile=config['certificate']['ca'])
    with httpx.Client(verify=verify, timeout=10, follow_redirects=False) as client:
        for body in bodies:
            raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
            for attempt in range(2):
                timestamp = str(int(datetime.now(timezone.utc).timestamp()))
                nonce = uuid.uuid4().hex
                response = client.post(base + '/tournaments-api/gamelink/result/', content=raw, headers={
                    'Content-Type': 'application/json', 'X-Gamelink-Timestamp': timestamp,
                    'X-Gamelink-Nonce': nonce, 'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
                    'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
                })
                require(response.status_code == 200, 'Signed duplicate result was refused')
                acknowledgement = response.json()
                require(acknowledgement.get('status') == 'already_recorded', 'Duplicate result was not acknowledged idempotently')
                acknowledgements.append({'fixture_id': body['fixture_id'], 'repeat': attempt + 1,
                                         'status': acknowledgement['status']})
    write_private(Path(config['run_dir']) / 'result-replay.json', json.dumps({
        'scope': 'Disposable only; replay of unchanged naturally completed signed results',
        'acknowledgements': acknowledgements,
    }, indent=2))
    print(f'RESULT_REPLAY_DONE count={len(acknowledgements)}; no game outcomes injected')


def status(config, service):
    database = Path(config["databases"][service])
    output = {"E2E_DISPOSABLE": True, "service": service, "run_id": config["run_id"],
              "database": str(database), "database_exists": database.is_file(),
              "excluded_integrations": config["excluded_integrations"]}
    postgresql = config.get('database_mode') == 'postgresql'
    output['database_engine'] = config.get('database_mode', 'sqlite')
    if postgresql or database.is_file():
        from contextlib import closing
        if postgresql:
            from postgresql_runtime import readonly
            reader = readonly(config, service)
        else:
            reader = closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5))
        with reader as db:
            if postgresql:
                output['database_exists'] = True
                tables = {row[0] for row in db.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")}
                output['postgresql'] = dict(db.execute(
                    "SELECT current_database() AS database, current_user AS role, version() AS version, "
                    "current_setting('transaction_isolation') AS isolation, "
                    "current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS synchronous_commit, "
                    "current_setting('full_page_writes') AS full_page_writes").fetchone())
                columns_of = db.columns
            else:
                db.row_factory = sqlite3.Row
                db.execute('PRAGMA query_only=ON')
                output['journal_mode'] = db.execute('PRAGMA journal_mode').fetchone()[0]
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                columns_of = lambda table: {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
            output["table_counts"] = {
                name: db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                for name in sorted(tables) if name in {
                    "auth_user", "tournaments_tournament", "tournaments_fixture", "tournaments_participation",
                    "gamelink_gamelink", "gamelink_issuedticket", "game_gameroom", "game_roomplayer", "game_match",
                    "game_gameevent", "game_tournamentlink", "game_redeemedticket",
                }
            }
            task_table = "frontend_task" if service == "tournament" else "game_task"
            if task_table in tables:
                output["tasks"] = [dict(row) for row in db.execute(
                    f'SELECT name,status,COUNT(*) AS count,SUM(attempts) AS attempts,'
                    f"SUM(CASE WHEN COALESCE(last_error,'') <> '' THEN 1 ELSE 0 END) AS with_error "
                    f'FROM "{task_table}" GROUP BY name,status ORDER BY name,status')]
                task_columns = columns_of(task_table)
                if 'key' in task_columns:
                    output['duplicate_active_task_keys'] = [dict(row) for row in db.execute(
                        f'SELECT key,COUNT(*) AS count FROM "{task_table}" '
                        "WHERE key IS NOT NULL AND status IN ('pending','running') "
                        'GROUP BY key HAVING COUNT(*) > 1')]
            if "game_tournamentlink" in tables:
                output["result_delivery"] = [dict(row) for row in db.execute(
                    "SELECT tournament_id,fixture_id,result_status,delivered_at FROM game_tournamentlink ORDER BY fixture_id")]
                output["linked_rooms"] = []
                for row in db.execute(
                    "SELECT link.tournament_id,link.fixture_id,link.result_status,room.id AS room_id,"
                    "room.status,room.white_score,room.black_score,room.target_points,room.last_sequence,"
                    "state.state_data FROM game_tournamentlink link JOIN game_gameroom room ON room.id=link.room_id "
                    "LEFT JOIN game_gamestate state ON state.room_id=room.id ORDER BY link.fixture_id"
                ):
                    item = dict(row)
                    raw_state = item.pop('state_data')
                    state = raw_state if isinstance(raw_state, dict) else json.loads(raw_state or '{}')
                    item["state"] = {key: state.get(key) for key in (
                        "home", "winner", "phase", "matchOver", "matchScored", "gameEndReason",
                    )}
                    winner = state.get("winner")
                    item["natural_bear_off"] = (
                        winner in ("white", "black") and (state.get("home") or {}).get(winner) == 15
                        and state.get("gameEndReason") == "move"
                    )
                    item["matches"] = [dict(match) for match in db.execute(
                        "SELECT id,winner,end_reason,white_score,black_score FROM game_match WHERE room_id=? ORDER BY created_at",
                        (item["room_id"],),
                    )]
                    item["seats"] = [dict(seat) for seat in db.execute(
                        "SELECT color,player_id FROM game_roomplayer WHERE room_id=? ORDER BY color", (item["room_id"],),
                    )]
                    output["linked_rooms"].append(item)
            if "tournaments_wallettransaction" in tables:
                output["wallet_totals"] = [dict(row) for row in db.execute(
                    "SELECT tournament_id,kind,COUNT(*) AS count,SUM(amount) AS amount FROM tournaments_wallettransaction "
                    "GROUP BY tournament_id,kind ORDER BY tournament_id,kind")]
            if "tournaments_participation" in tables:
                output["podium"] = [dict(row) for row in db.execute(
                    "SELECT tournament_id,participant_id,podium_position FROM tournaments_participation "
                    "WHERE podium_position IS NOT NULL ORDER BY tournament_id,podium_position")]
            if "tournaments_tournament" in tables:
                columns = columns_of('tournaments_tournament')
                has_pause = "entry_deadline_paused" in columns
                require(has_pause or config.get("profile") == "server-existing",
                        "local tournament schema is missing entry_deadline_paused")
                output["entry_deadline_pause_column_present"] = has_pause
                pause_field = "entry_deadline_paused" if has_pause else "NULL AS entry_deadline_paused"
                output["tournaments"] = [dict(row) for row in db.execute(
                    f"SELECT id,name,starts_at,published,{pause_field},results_confirmed_at "
                    "FROM tournaments_tournament ORDER BY id")]
            if "tournaments_fixture" in tables:
                output["fixtures"] = [dict(row) for row in db.execute(
                    "SELECT mode.tournament_id,fixture.id,fixture.level,fixture.player1_id,fixture.player2_id,"
                    "fixture.score1,fixture.score2,fixture.auto_confirmed,fixture.admin_result,fixture.playable_at "
                    "FROM tournaments_fixture fixture JOIN tournaments_mode mode ON mode.id=fixture.mode_id "
                    "ORDER BY mode.tournament_id,fixture.level,fixture.id")]
            if "tournaments_wallettransaction" in tables:
                output["prize_awards"] = [dict(row) for row in db.execute(
                    "SELECT tournament_id,user_id,COUNT(*) AS count,SUM(amount) AS amount "
                    "FROM tournaments_wallettransaction WHERE kind='tournament_prize' "
                    "GROUP BY tournament_id,user_id ORDER BY tournament_id,user_id")]
            tasks = output.get("tasks", [])
            output["core_tasks"] = [task for task in tasks if ".deliver_analysis" not in task["name"]]
            output["excluded_analysis_tasks"] = [task for task in tasks if ".deliver_analysis" in task["name"]]
    artifact = Path(config["run_dir"]) / "artifacts" / f"{service}-status-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    write_private(artifact, json.dumps(output, indent=2, default=str) + "\n")
    output["artifact"] = str(artifact)
    latest = Path(config["run_dir"]) / f"status-{service}.json"
    require(not latest.is_symlink(), "status destination must not be a symbolic link")
    temporary = latest.with_name(f".status-{service}-{uuid.uuid4().hex}.json")
    write_private(temporary, json.dumps(output, indent=2, default=str) + "\n")
    os.replace(temporary, latest)
    print(json.dumps(output, indent=2, default=str))


def test_locks(config, service):
    """Only the fresh run database is used, before seeding/starting services."""
    from django.db import connection
    from django.test.runner import DiscoverRunner
    require(config.get('database_mode') == 'postgresql' and connection.vendor == 'postgresql',
            'PostgreSQL locking tests cannot run on SQLite')
    from postgresql_runtime import readonly
    with readonly(config, service) as database:
        table = 'game_gameroom' if service == 'game' else 'tournaments_tournament'
        require(database.execute('SELECT COUNT(*) FROM auth_user').fetchone()[0] == 0
                and database.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0,
                'locking tests require a fresh database before account/game seeding')
    write_private(Path(config['run_dir']) / f'test-locks-{service}-started.json',
                  json.dumps({'run_id': config['run_id'], 'started_at': datetime.now(timezone.utc).isoformat()}))
    class LockRunner(DiscoverRunner):
        def setup_databases(self, **kwargs):
            # The orchestrator already migrated fresh run-owned databases.
            # Use Django's runner hook to avoid maintenance DB connections and
            # CREATE/DROP DATABASE entirely. TestCase transactions/flushes still
            # run normally against this service's guarded, empty run database.
            return []

        def run_suite(self, suite, **kwargs):
            result = super().run_suite(suite, **kwargs)
            require(result.testsRun >= (43 if service == 'game' else 7) and not result.skipped,
                    'locking coverage was incomplete or skipped')
            return result

    labels = (['game.link.test_postgresql_locking', 'game.tests.test_task_ownership',
               'game.tests.test_action_latency', 'game.tests.test_connection_setup',
               'game.tests.test_room_execution'] if service == 'game' else
              ['gamelink.test_postgresql_locking', 'frontend.test_task_ownership.ConcurrentTaskOwnershipTests',
               'tournaments.test_wallet_idempotency.ConcurrentWalletTests',
               'frontend.test_lobby_events', 'gamelink.test_event_entry'])
    previous = os.environ.get('ENTRY_REDIS_TESTS')
    # Real Lua coverage uses its own random key prefix on the run-owned Redis.
    os.environ['ENTRY_REDIS_TESTS'] = '1'
    try:
        failures = LockRunner(interactive=False, verbosity=2).run_tests(labels)
    finally:
        if previous is None:
            os.environ.pop('ENTRY_REDIS_TESTS', None)
        else:
            os.environ['ENTRY_REDIS_TESTS'] = previous
    require(not failures, 'PostgreSQL locking regression failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--service", choices=("game", "tournament"))
    parser.add_argument("action", choices=("init", "migrate", "seed-admin", "check", "daphne", "manage", "status", "replay-results", "test-locks", "inventory"))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.action == "init":
        require(args.service is None and not args.command, "init accepts no service or extra arguments")
        initialize(args.run_dir)
        return
    require(args.service is not None, "--service is required")
    require(args.action == "manage" or not args.command, "unexpected command arguments")
    config = prepare_runtime(args.run_dir, args.service)
    if args.action == 'inventory':
        from runtime_inventory import inventory
        inventory(config, args.service)
        return
    if args.action == "status":
        status(config, args.service)
        return
    if args.action == "manage":
        require(bool(args.command), "manage requires a command")
        require(args.command[0] in {"run_tasks_worker", "run_tasks", "check", "showmigrations"},
                "only existing worker and inspection commands are permitted")
        require(not any(value.startswith(("--settings", "--pythonpath", "--database", "--skip-checks")) for value in args.command),
                "management commands cannot override isolation settings or checks")
    setup_django(config, args.service)
    from django.core.management import call_command, execute_from_command_line
    if args.action == 'test-locks':
        test_locks(config, args.service)
    elif args.action == "replay-results":
        replay_results(config, args.service)
    elif args.action == "seed-admin":
        call_command("check")
        seed_admin(config, args.service)
    elif args.action == "daphne":
        call_command("check")
        from daphne.cli import CommandLineInterface
        application = "tournaments.asgi:application" if args.service == "tournament" else "backgammon_project.asgi:application"
        CommandLineInterface().run([
            "-b", "127.0.0.1", "-p", str(PORTS[f"{args.service}_backend"]),
            # The orchestrator redacts ticket/token query values before saving
            # this stream. Do not create a second raw access-log artifact.
            "--access-log", "-", application,
        ])
    elif args.action == "migrate":
        call_command("migrate", interactive=False)
    elif args.action == "check":
        call_command("check")
    else:
        execute_from_command_line(["manage.py", *args.command])


if __name__ == "__main__":
    main()
