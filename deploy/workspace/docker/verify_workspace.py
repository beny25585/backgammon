"""Verify the prepared release sources and public deployment files before building."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

SOURCE_PATHS = {
    "Backgammon Game",
    "backgammon-analysis-service",
    "backgammon-tournaments",
    "backgammon-tournaments-backend",
}


def verify():
    root = Path(__file__).resolve().parents[1]
    record = json.loads((root / ".workspace-release.json").read_text(encoding="utf-8"))
    if record["schema_version"] != 1:
        raise ValueError("Unsupported prepared release version.")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,59}", record["image_tag"]):
        raise ValueError("Invalid prepared image tag.")
    sources = record["sources"]
    if len(sources) != 4 or {source["path"] for source in sources} != SOURCE_PATHS:
        raise ValueError("Prepared release must include all four sources.")
    for source in sources:
        if not re.fullmatch(r"[0-9a-f]{40}", source["revision"]):
            raise ValueError("Invalid source revision.")
        directory = root / source["path"]
        if 'source_files' in record:
            expected_files = record['source_files'][source['path']]
            if not expected_files or directory.is_symlink():
                raise ValueError('Missing or unsafe committed source export: ' + source['path'])
            actual_files = {}
            for path in directory.rglob('*'):
                if path.is_symlink():
                    raise ValueError('Source export contains a symlink: ' + str(path))
                if path.is_file():
                    actual_files[path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual_files != expected_files:
                raise ValueError('Committed source export changed: ' + source['path'])
            continue
        command = ["git", "-C", str(directory)]
        revision = subprocess.check_output([*command, "rev-parse", "HEAD"], text=True).strip()
        status = subprocess.check_output([*command, "status", "--porcelain"], text=True).strip()
        if revision != source["revision"] or status:
            raise ValueError(f"Source differs from the prepared release: {source['path']}")
    if not record["files"]:
        raise ValueError("Prepared deployment file inventory is missing.")
    for relative, expected in record["files"].items():
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid prepared file path.")
        actual = hashlib.sha256((root / relative).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"Deployment file differs from the prepared release: {relative}")
    environment = (root / "docker" / "production.env").read_text(encoding="utf-8").splitlines()
    tags = [line.split("=", 1)[1].strip() for line in environment if line.startswith("IMAGE_TAG=")]
    if tags != [record["image_tag"]]:
        raise ValueError("production.env image tag differs from the release manifest.")
    return record["image_tag"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print-tag", action="store_true")
    parser.add_argument("--print-revision", choices=sorted(SOURCE_PATHS))
    arguments = parser.parse_args()
    try:
        tag = verify()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release verification stopped: {error}", file=sys.stderr)
        return 1
    if arguments.print_revision:
        root = Path(__file__).resolve().parents[1]
        record = json.loads((root / '.workspace-release.json').read_text(encoding='utf-8'))
        print(next(source['revision'] for source in record['sources'] if source['path'] == arguments.print_revision))
    else:
        print(tag if arguments.print_tag else f"Prepared release verified: {tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
