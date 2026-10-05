"""Create a private PostgreSQL dump and SQLite snapshots without stopping services."""

import argparse
import hashlib
import json
import sqlite3
import subprocess
from contextlib import closing
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    dump = directory / "game.dump"
    with dump.open("xb") as output:
        subprocess.run(
            ["sudo", "-u", "postgres", "pg_dump", "--format=custom", "backgammon_db"],
            stdout=output,
            check=True,
        )
    dump.chmod(0o600)
    sources = {
        "tournaments": Path(
            "/home/dev/backgammon-tournaments-backend/tournaments/db.sqlite3"
        ),
        "analysis": Path("/home/dev/backgammon-analysis-service/db.sqlite3"),
    }
    for name, source in sources.items():
        if not source.is_file():
            raise FileNotFoundError(f"Expected {name} SQLite database was not found.")
        destination = directory / f"{name}.sqlite3"
        with (
            closing(
                sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True, timeout=10)
            ) as existing,
            closing(sqlite3.connect(destination)) as copy,
        ):
            existing.backup(copy, pages=256, sleep=0.1)
            if copy.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise RuntimeError(f"{name} SQLite snapshot failed quick_check.")
        destination.chmod(0o600)
    hashes = {}
    for path in directory.iterdir():
        with path.open("rb") as content:
            digest = hashlib.file_digest(content, "sha256").hexdigest()
        hashes[path.name] = digest
    manifest = directory / "sha256.json"
    manifest.write_text(json.dumps(hashes, indent=2) + "\n")
    manifest.chmod(0o600)
    print(
        "Database snapshots saved privately. Independent snapshots are not a cross-service transaction."
    )
    print(
        "For final transfer, stop all writes before taking this backup. Analysis is backed up but not imported."
    )


if __name__ == "__main__":
    main()
