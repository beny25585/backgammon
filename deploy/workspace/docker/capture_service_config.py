"""Save selected effective settings privately on the server; never print their values."""

import argparse
import json
import os
import sys
from pathlib import Path

from prepare_production import RESERVED
from service_runtime import enter_service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("game", "tournaments", "analysis"))
    parser.add_argument("--service")
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if args.service:
        enter_service(args.service)
    if not os.environ.get("DJANGO_SETTINGS_MODULE"):
        fallback = {
            "game": "backgammon_project.settings",
            "tournaments": "tournaments.settings.development",
            "analysis": "config.settings",
        }
        os.environ["DJANGO_SETTINGS_MODULE"] = fallback[args.kind]
    sys.path.insert(0, os.getcwd())
    from django.conf import settings

    prefixes = ("GAMELINK_", "WEB_PUSH_", "GOOGLE_", "EMAIL_", "TRANZILA_", "ACCOUNT_")
    names = {"SECRET_KEY", "ANALYSIS_API_TOKEN", "DEFAULT_FROM_EMAIL"}
    if args.kind == "tournaments":
        names.update(name for name in dir(settings) if name.startswith(prefixes))
        names.update(name for name in os.environ if name.startswith(prefixes))
    elif args.kind == "game":
        names.update(name for name in dir(settings) if name.startswith("GAMELINK_"))
        names.update(name for name in os.environ if name.startswith("GAMELINK_"))
    values = {}
    for name in sorted(names - RESERVED):
        value = getattr(settings, name, os.environ.get(name, ""))
        if isinstance(value, bool):
            values[name] = (
                ("1" if value else "0") if args.kind != "game" else str(value)
            )
        elif isinstance(value, (list, tuple)) and all(
            isinstance(item, str) for item in value
        ):
            values[name] = ",".join(value)
        elif isinstance(value, (str, int, float)):
            values[name] = str(value)
    directory = args.directory.resolve()
    if not directory.is_dir():
        raise ValueError("Prepare the private configuration directory first.")
    path = directory / f"{args.kind}.json"
    with path.open("x", encoding="utf-8") as output:
        json.dump(values, output, indent=2)
        output.write("\n")
    path.chmod(0o644)
    print(
        f"Saved {args.kind} configuration privately. Existing files are never overwritten."
    )


if __name__ == "__main__":
    main()
