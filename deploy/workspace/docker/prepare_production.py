"""Prepare database credentials; production application credentials are captured separately."""

import argparse
import json
import secrets
from pathlib import Path

REQUIRED = {
    "game": (
        "SECRET_KEY",
        "GAMELINK_TICKET_SECRETS",
        "GAMELINK_RESULT_SECRET",
        "GAMELINK_COMMAND_SECRETS",
        "ANALYSIS_API_TOKEN",
    ),
    "tournaments": (
        "SECRET_KEY",
        "GAMELINK_TICKET_SECRET",
        "GAMELINK_RESULT_SECRETS",
        "GAMELINK_COMMAND_SECRET",
        "ANALYSIS_API_TOKEN",
    ),
    "analysis": ("SECRET_KEY", "ANALYSIS_API_TOKEN"),
}
RESERVED = {
    "DEBUG",
    "DATABASE_URL",
    "DJANGO_SETTINGS_MODULE",
    "ALLOWED_HOSTS",
    "CSRF_TRUSTED_ORIGINS",
    "REDIS_URL",
    "RUNTIME_CONFIG_FILE",
    "DB_PASSWORD_FILE",
    "GAMELINK_BACKGAMMON_URL",
    "GAMELINK_TOURNAMENTS_URL",
    "GAMELINK_TOURNAMENTS_FRONTEND_URL",
    "GAMELINK_FRONTEND_URL",
    "ACCOUNT_FRONTEND_URL",
    "AI_SERVICE_URL",
    "ANALYSIS_SERVICE_URL",
    "DICE_SERVICE_URL",
}


def validate(directory):
    configurations = {}
    for kind, required in REQUIRED.items():
        values = json.loads((directory / f"{kind}.json").read_text())
        if not isinstance(values, dict) or any(
            not isinstance(value, str) for value in values.values()
        ):
            raise ValueError(f"{kind}.json must contain string values.")
        if RESERVED.intersection(values) or any(
            key.startswith("DB_") for key in values
        ):
            raise ValueError(
                f"{kind}.json overrides container infrastructure settings."
            )
        if any(not values.get(key) for key in required):
            raise ValueError(
                f"{kind}.json is missing required application credentials."
            )
        configurations[kind] = values
    game = configurations["game"]
    tournaments = configurations["tournaments"]
    pairs = (
        (
            tournaments["GAMELINK_TICKET_SECRET"],
            game["GAMELINK_TICKET_SECRETS"].split(","),
        ),
        (
            game["GAMELINK_RESULT_SECRET"],
            tournaments["GAMELINK_RESULT_SECRETS"].split(","),
        ),
        (
            tournaments["GAMELINK_COMMAND_SECRET"],
            game["GAMELINK_COMMAND_SECRETS"].split(","),
        ),
    )
    if any(single not in accepted for single, accepted in pairs):
        raise ValueError("GameLink credentials do not agree across the services.")
    if len({configurations[name]["ANALYSIS_API_TOKEN"] for name in REQUIRED}) != 1:
        raise ValueError("Analysis API credentials do not agree across the services.")
    for name in ("postgres", "game", "tournaments", "analysis"):
        if not (directory / f"{name}_password").read_text().strip():
            raise ValueError(f"Missing {name} database password.")
    print("Production credentials validated; no credential values displayed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("passwords", "validate"))
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.action == "validate":
        validate(directory)
        return
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    for name in ("postgres", "game", "tournaments", "analysis"):
        path = directory / f"{name}_password"
        if path.exists():
            print(f"Existing {name} database password preserved.")
            continue
        with path.open("x", encoding="utf-8") as output:
            output.write(secrets.token_urlsafe(48) + "\n")
        # Only the host directory owner can reach these files. Compose mounts
        # individual files for the non-root application users.
        path.chmod(0o644)
    print(
        "Database credentials prepared. Capture the three existing service configurations next."
    )


if __name__ == "__main__":
    main()
