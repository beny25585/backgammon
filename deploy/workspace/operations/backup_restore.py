"""SQLite backup + restore drill. Writes only to new directories, never over a live DB.

Quiesce both application writers and task workers for a consistent product recovery point.
Run: python operations/backup_restore.py --database tournaments=PATH --database game=PATH --output NEW_DIRECTORY
"""
import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def inspect(path):
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Integrity check failed'
        assert not db.execute('PRAGMA foreign_key_check').fetchall(), 'Foreign key check failed'
        digest = hashlib.sha256()
        for line in db.iterdump():
            digest.update(line.encode('utf-8'))
            digest.update(b'\n')
        tables = db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        counts = {name: db.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
                  for (name,) in tables}
        return {'logical_sha256': digest.hexdigest(), 'rows': counts}


def copy_database(source, destination):
    if destination.exists():
        raise ValueError(f'Refusing to overwrite {destination}')
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(destination) as dst:
            src.backup(dst)


def backup_and_restore(databases, output):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output must be a new directory')
    for name, source in databases.items():
        if not name.isidentifier() or not Path(source).is_file():
            raise ValueError('Each database needs a simple name and an existing SQLite file')
    output.mkdir(parents=True)
    restore = output / 'restore-drill'
    restore.mkdir()
    manifest = {'created_at': datetime.now(timezone.utc).isoformat(), 'databases': {}}
    for name, source in databases.items():
        snapshot = output / f'{name}.sqlite3'
        recovered = restore / f'{name}.sqlite3'
        copy_database(Path(source), snapshot)
        expected = inspect(snapshot)
        copy_database(snapshot, recovered)
        actual = inspect(recovered)
        if actual != expected:
            raise ValueError(f'Restored database differs: {name}')
        manifest['databases'][name] = {**expected, 'restored_and_verified': True}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', action='append', required=True, metavar='NAME=PATH')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(backup_and_restore(dict(item.split('=', 1) for item in args.database), args.output), indent=2))
