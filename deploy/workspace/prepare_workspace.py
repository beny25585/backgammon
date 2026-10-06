"""Prepare a new release from committed deployment files and pinned Git sources."""

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

SOURCE_PATHS = {
    "Backgammon Game",
    "backgammon-analysis-service",
    "backgammon-tournaments",
    "backgammon-tournaments-backend",
}


def git(directory, *arguments, capture=True):
    directory = Path(directory).resolve()
    safe_root = next((parent for parent in (directory, *directory.parents) if (parent / '.git').exists()), directory)
    return subprocess.run(
        ["git", "-c", "safe.directory=" + str(safe_root), "-C", str(directory), *arguments],
        check=True,
        stdout=subprocess.PIPE if capture else None,
    ).stdout


def deployment_files():
    directory = Path(__file__).resolve().parent
    repository = Path(git(directory, "rev-parse", "--show-toplevel").decode().strip())
    prefix = directory.relative_to(repository).as_posix() + "/"
    if git(repository, "status", "--porcelain", "--", prefix).strip():
        raise ValueError("Deployment files have uncommitted changes; commit them first.")
    revision = git(repository, "rev-parse", "HEAD").decode().strip()
    archive = git(repository, "archive", "--format=tar", revision, "--", prefix)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
        for member in bundle.getmembers():
            if member.isdir():
                continue
            if not member.isfile() or not member.name.startswith(prefix):
                raise ValueError("Unexpected entry in the committed deployment files.")
            relative = PurePosixPath(member.name[len(prefix):])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Deployment file has an unsafe path.")
            with bundle.extractfile(member) as source:
                files[relative.as_posix()] = source.read()
    if files.get("prepare_workspace.py") != Path(__file__).read_bytes().replace(b"\r\n", b"\n"):
        raise ValueError("Run the committed preparation script from its Git checkout.")
    return revision, files


def validate_release(files):
    release = json.loads(files["release.json"])
    if release["schema_version"] != 1:
        raise ValueError("Unsupported release manifest version.")
    tag = release["image_tag"]
    if not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,59}", tag):
        raise ValueError("Release image tag is invalid.")
    sources = release["sources"]
    if len(sources) != 4 or {source["path"] for source in sources} != SOURCE_PATHS:
        raise ValueError("Release must pin all four source repositories.")
    for source in sources:
        if not re.fullmatch(r"[0-9a-f]{40}", source["revision"]):
            raise ValueError("Each source requires a full Git commit ID.")
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git", source["url"]):
            raise ValueError("Source URL must be a GitHub HTTPS URL without credentials.")
    return release


def prepare(destination, resume=False):
    revision, files = deployment_files()
    release = validate_release(files)
    expected = {"infrastructure_revision": revision, "release": release}
    marker = destination / '.preparation.json'
    if os.path.lexists(destination):
        if not resume or destination.is_symlink() or not marker.is_file() or marker.is_symlink():
            raise ValueError("Destination already exists without an owned preparation; choose a new directory.")
        if json.loads(marker.read_text()) != expected:
            raise ValueError("Partial workspace belongs to different source revisions.")
    else:
        destination.mkdir(parents=True, exist_ok=False, mode=0o700)
        marker.write_text(json.dumps(expected, indent=2) + '\n', encoding='utf-8')
        marker.chmod(0o600)
    print(f"Preparing {destination}", flush=True)
    for source in release["sources"]:
        checkout = destination / source["path"]
        print(f"Cloning {source['path']} at {source['revision'][:12]}", flush=True)
        if not checkout.exists():
            git(destination, "clone", "--filter=blob:none", "--no-checkout", "--", source["url"], str(checkout), capture=False)
        elif (checkout.is_symlink() or not (checkout / '.git').is_dir()
              or git(checkout, 'remote', 'get-url', 'origin').decode().strip() != source['url']):
            raise ValueError('Partial source checkout is unsafe: ' + source['path'])
        current = git(checkout, 'rev-parse', 'HEAD').decode().strip()
        status = git(checkout, 'status', '--porcelain', '--untracked-files=all').decode()
        # A no-checkout clone reports staged deletions; never reset a populated dirty tree.
        pristine_clone = all(line.startswith('D  ') for line in status.splitlines()) and not any(
            child.name != '.git' for child in checkout.iterdir())
        if status and not pristine_clone:
            raise ValueError('Partial source checkout contains local edits: ' + source['path'])
        if current != source['revision'] and not pristine_clone:
            raise ValueError('Partial checkout contains a different populated revision: ' + source['path'])
        git(checkout, "checkout", "--detach", source["revision"], capture=False)
        if git(checkout, "rev-parse", "HEAD").decode().strip() != source["revision"]:
            raise ValueError(f"Source revision differs: {source['path']}")
    for relative, content in files.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.is_symlink() or target.read_bytes() != content:
                raise ValueError('Partial deployment file changed: ' + relative)
        else:
            with target.open("xb") as output:
                output.write(content)
        # Public config is mounted into containers that run with different UIDs.
        # The private workspace directory still prevents unrelated host access.
        target.chmod(0o755 if target.suffix == ".sh" else 0o644)
    environment = files["docker/production.env.example"].decode()
    environment = environment.replace("IMAGE_TAG=replace-with-reviewed-release", f"IMAGE_TAG={release['image_tag']}")
    environment = environment.replace("TRANSFER_DIR=/home/administrator/backgammon-transfer", f"TRANSFER_DIR={Path.home() / 'backgammon-transfer'}")
    environment_path = destination / "docker" / "production.env"
    if not environment_path.exists():
        with environment_path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(environment)
    elif environment_path.is_symlink():
        raise ValueError('Unsafe private environment file')
    environment_path.chmod(0o600)
    record = {
        "schema_version": 1,
        "infrastructure_revision": revision,
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "image_tag": release["image_tag"],
        "sources": release["sources"],
        "files": {path: hashlib.sha256(content).hexdigest() for path, content in files.items()},
    }
    with (destination / ".workspace-release.json").open("x", encoding="utf-8", newline="\n") as output:
        output.write(json.dumps(record, indent=2) + "\n")
    print("Git sources and deployment files prepared; application services have not been started.")
    print(f"Next: cd {destination}")
    print("Then: bash docker/build_on_server.sh")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--resume", action='store_true', help='Resume only this marked, immutable partial workspace')
    arguments = parser.parse_args()
    os.umask(0o077)
    try:
        destination = arguments.destination.expanduser().absolute()
        if destination.is_symlink():
            raise ValueError('Destination must not be a symlink')
        prepare(destination.resolve(), resume=arguments.resume)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"Preparation stopped: {error}", file=sys.stderr)
        print("Any partial release directory is preserved. No running services were changed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
