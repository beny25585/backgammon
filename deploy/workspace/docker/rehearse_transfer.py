"""Rehearse synthetic SQLite/PostgreSQL transfers in a new, isolated Docker project."""

import argparse
import hashlib
import json
import secrets
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tournaments-image", default="backgammon-local-tournaments:latest"
    )
    parser.add_argument("--game-image", default="backgammon-local-game:latest")
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    workspace = tools.parent
    identifier = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + secrets.token_hex(4)
    )
    project = "backgammon-rehearsal-" + identifier.lower()
    root = tools / ".production" / ("rehearsal-" + identifier)
    root.mkdir(parents=True, mode=0o700)
    work = root / "work"
    work.mkdir(mode=0o777)
    work.chmod(0o777)  # Private parent stays 0700; app UID 10001 needs the bind mount.
    helper_dir = root / "tools"
    helper_dir.mkdir()
    for name in (
        "runtime_env.py",
        "tournaments_transfer.py",
        "service_runtime.py",
        "rehearsal_settings.py",
        "rehearsal_data.py",
    ):
        shutil.copyfile(tools / name, helper_dir / name)
    ignore = shutil.ignore_patterns(
        ".env*",
        ".git",
        "*venv*",
        "node_modules",
        "__pycache__",
        "*.sqlite3*",
        "*.db",
        "*.log",
        "media",
        "staticfiles",
    )
    for kind, source in (
        ("tournaments", workspace / "backgammon-tournaments-backend" / "tournaments"),
        ("game", workspace / "Backgammon Game" / "backend"),
    ):
        shutil.copytree(source, root / kind, ignore=ignore)
    private = root / "secrets"
    private.mkdir(mode=0o700)
    for name in ("postgres", "game", "tournaments"):
        (private / name).write_text(secrets.token_urlsafe(48), encoding="utf-8")
        (private / name).chmod(0o644)
    (private / "app.json").write_text(
        json.dumps({"SECRET_KEY": secrets.token_urlsafe(48)}), encoding="utf-8"
    )
    (private / "app.json").chmod(0o644)
    init_script = root / "init.sh"
    init_script.write_text(
        "#!/bin/sh\nset -eu\n"
        "for kind in game tournaments; do\n"
        '  export REHEARSAL_USER="rehearsal_${kind}"\n'
        '  export REHEARSAL_PASSWORD="$(cat /run/secrets/${kind})"\n'
        "  psql -U postgres -d postgres --set ON_ERROR_STOP=1 <<'SQL'\n"
        "\\getenv app_user REHEARSAL_USER\n"
        "\\getenv app_password REHEARSAL_PASSWORD\n"
        "CREATE ROLE :\"app_user\" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;\n"
        "SQL\ndone\n"
        "psql -U postgres -d postgres --set ON_ERROR_STOP=1 <<'SQL'\n"
        "CREATE DATABASE rehearsal_game_source OWNER rehearsal_game;\n"
        "CREATE DATABASE rehearsal_game_target OWNER rehearsal_game;\n"
        "CREATE DATABASE rehearsal_tournaments OWNER rehearsal_tournaments;\nSQL\n",
        encoding="utf-8",
        newline="\n",
    )

    def bind(path, target, readonly=True):
        return {
            "type": "bind",
            "source": str(path),
            "target": target,
            "read_only": readonly,
        }

    def pin(image):
        return subprocess.check_output(
            ["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True
        ).strip()

    images = {"game": pin(args.game_image), "tournaments": pin(args.tournaments_image)}
    configuration = {
        "name": project,
        "networks": {"default": {"internal": True}},
        "secrets": {
            name: {"file": str(private / name)}
            for name in ("postgres", "game", "tournaments", "app.json")
        },
        "services": {
            "postgres": {
                "image": pin("postgres:16"),
                "restart": "no",
                "mem_limit": "256m",
                "environment": {"POSTGRES_PASSWORD_FILE": "/run/secrets/postgres"},
                "secrets": ["postgres", "game", "tournaments"],
                "volumes": [
                    {"type": "volume", "target": "/var/lib/postgresql/data"},
                    bind(init_script, "/docker-entrypoint-initdb.d/10-init.sh"),
                ],
                "healthcheck": {
                    "test": ["CMD-SHELL", "pg_isready -U postgres"],
                    "interval": "2s",
                    "timeout": "5s",
                    "retries": 30,
                },
            }
        },
    }
    for name, kind, database, sqlite in (
        ("tournaments-source", "tournaments", "rehearsal_tournaments", True),
        ("tournaments-target", "tournaments", "rehearsal_tournaments", False),
        ("game-source", "game", "rehearsal_game_source", False),
        ("game-target", "game", "rehearsal_game_target", False),
    ):
        configuration["services"][name] = {
            "image": images[kind],
            "pull_policy": "never",
            "restart": "no",
            "mem_limit": "384m",
            "user": "10001:10001",
            "working_dir": "/app",
            "entrypoint": ["python", "/tools/runtime_env.py"],
            "command": ["python", "manage.py", "migrate", "--noinput"],
            "environment": {
                "RUN_TRANSFER_REHEARSAL": "1",
                "REHEARSAL_KIND": kind,
                "REHEARSAL_SQLITE": "1" if sqlite else "0",
                "DJANGO_SETTINGS_MODULE": "rehearsal_settings",
                "PYTHONPATH": "/tools:/app",
                "RUNTIME_CONFIG_FILE": "/run/secrets/app.json",
                "DB_HOST": "postgres",
                "DB_NAME": database,
                "DB_USER": "rehearsal_" + kind,
                "DB_PASSWORD_FILE": "/run/secrets/" + kind,
                "DEBUG": "False",
                "GAMELINK_ENABLED": "False" if kind == "game" else "0",
                "GAMELINK_BACKGAMMON_URL": "https://rehearsal.invalid",
                "ACCOUNT_FRONTEND_URL": "https://rehearsal.invalid/tournaments",
                "ALLOWED_HOSTS": "localhost",
                "EMAIL_BACKEND": "django.core.mail.backends.dummy.EmailBackend",
                "GOOGLE_CLIENT_ID": "",
                "TRANZILA_ENABLED": "0",
                "TRANZILA_PURCHASES_ENABLED": "0",
            },
            "secrets": [kind, "app.json"],
            "volumes": [
                bind(root / kind, "/app"),
                bind(helper_dir, "/tools"),
                bind(work, "/work", False),
            ],
            "depends_on": {"postgres": {"condition": "service_healthy"}},
        }
    compose = root / "compose.json"
    compose.write_text(json.dumps(configuration, indent=2), encoding="utf-8")
    command = ["docker", "compose", "-p", project, "-f", str(compose)]
    report = {
        "project": project,
        "data": "synthetic only",
        "image_ids": images,
        "steps": [],
        "status": "running",
    }
    log = root / "operations.log"

    def run(
        label, arguments, expected=0, output=None, input_file=None, expected_text=None
    ):
        print(label, flush=True)
        offset = log.stat().st_size if log.exists() else 0
        with (
            log.open("ab") as diagnostics,
            output.open("xb") if output else log.open("ab") as destination,
        ):
            if input_file:
                with input_file.open("rb") as source:
                    result = subprocess.run(
                        command + arguments,
                        stdin=source,
                        stdout=destination,
                        stderr=diagnostics,
                        check=False,
                    )
            else:
                result = subprocess.run(
                    command + arguments,
                    stdout=destination,
                    stderr=diagnostics,
                    check=False,
                )
        report["steps"].append({"stage": label, "exit_code": result.returncode})
        if result.returncode != expected:
            raise RuntimeError(
                f"{label} returned {result.returncode}; inspect private operations.log"
            )
        if expected_text:
            with log.open("rb") as recorded:
                recorded.seek(offset)
                if expected_text.encode() not in recorded.read():
                    raise RuntimeError(f"{label} failed for an unexpected reason.")

    def app(service, *arguments):
        return ["run", "--rm", "--no-deps", service, *arguments]

    try:
        run(
            "Start isolated PostgreSQL",
            ["up", "-d", "--wait", "--wait-timeout", "90", "postgres"],
        )
        run(
            "Create SQLite source schema",
            app("tournaments-source", "python", "manage.py", "migrate", "--noinput"),
        )
        run(
            "Seed synthetic tournament data",
            app("tournaments-source", "python", "/tools/rehearsal_data.py", "seed"),
        )
        run(
            "Take SQLite snapshot",
            app("tournaments-source", "python", "/tools/rehearsal_data.py", "snapshot"),
        )
        run(
            "Export snapshot",
            app(
                "tournaments-source",
                "python",
                "/tools/tournaments_transfer.py",
                "export",
                "--sqlite",
                "/work/tournaments.snapshot.sqlite3",
                "--directory",
                "/work/tournaments",
            ),
        )
        run(
            "Create target PostgreSQL schema",
            app("tournaments-target", "python", "manage.py", "migrate", "--noinput"),
        )
        import_args = app(
            "tournaments-target",
            "python",
            "/tools/tournaments_transfer.py",
            "import",
            "--directory",
            "/work/tournaments",
            "--confirm-new-database",
            "rehearsal_tournaments",
        )
        run("Import SQLite data into PostgreSQL", import_args)
        run(
            "Verify tournament IDs/relations/money",
            app(
                "tournaments-target",
                "python",
                "/tools/tournaments_transfer.py",
                "verify",
                "--directory",
                "/work/tournaments",
            ),
        )
        run(
            "Verify tournament user sequence",
            app("tournaments-target", "python", "/tools/rehearsal_data.py", "sequence"),
        )
        run(
            "Refuse repeat import into populated target",
            import_args,
            expected=1,
            expected_text="contains data; import refused",
        )
        run(
            "Verify refused import preserved data",
            app(
                "tournaments-target",
                "python",
                "/tools/tournaments_transfer.py",
                "verify",
                "--directory",
                "/work/tournaments",
            ),
        )
        run(
            "Create source game schema",
            app("game-source", "python", "manage.py", "migrate", "--noinput"),
        )
        run(
            "Seed synthetic game data",
            app("game-source", "python", "/tools/rehearsal_data.py", "seed"),
        )
        run(
            "Record game source model fingerprints",
            app(
                "game-source",
                "python",
                "/tools/rehearsal_data.py",
                "audit",
                "/work/game-source.json",
            ),
        )
        run(
            "Dump source game PostgreSQL",
            [
                "exec",
                "-T",
                "postgres",
                "sh",
                "-c",
                'export PGPASSWORD="$(cat /run/secrets/game)"; exec pg_dump -h 127.0.0.1 -U rehearsal_game -d rehearsal_game_source --format=custom',
            ],
            output=work / "game.dump",
        )
        run(
            "Restore empty game target",
            [
                "exec",
                "-T",
                "postgres",
                "sh",
                "-c",
                'export PGPASSWORD="$(cat /run/secrets/game)"; exec pg_restore -h 127.0.0.1 -U rehearsal_game -d rehearsal_game_target --single-transaction --exit-on-error --no-owner --no-acl',
            ],
            input_file=work / "game.dump",
        )
        run(
            "Record restored game model fingerprints",
            app(
                "game-target",
                "python",
                "/tools/rehearsal_data.py",
                "audit",
                "/work/game-target.json",
            ),
        )
        if (work / "game-source.json").read_bytes() != (
            work / "game-target.json"
        ).read_bytes():
            raise ValueError("Game model fingerprints differ after restore.")
        run(
            "Verify restored game user sequence",
            app("game-target", "python", "/tools/rehearsal_data.py", "sequence"),
        )
        report["status"] = "passed"
        report["game_audit_sha256"] = hashlib.sha256(
            (work / "game-target.json").read_bytes()
        ).hexdigest()
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        # Only the unique project created above: no user-supplied project or volumes.
        if (
            not project.startswith("backgammon-rehearsal-")
            or configuration["name"] != project
        ):
            raise RuntimeError("Rehearsal cleanup scope is invalid.")
        try:
            run(
                "Stop rehearsal and remove its synthetic anonymous volumes",
                ["down", "--volumes"],
            )
        finally:
            (root / "report.json").write_text(
                json.dumps(report, indent=2), encoding="utf-8"
            )
            print(f"Report: {root / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
