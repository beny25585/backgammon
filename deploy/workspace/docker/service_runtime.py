"""Restart a diagnostic under a running service's environment, without printing it."""

import os
import subprocess
import sys
from pathlib import Path


def enter_service(service):
    process_id = subprocess.check_output(
        ["systemctl", "show", service, "-p", "MainPID", "--value"], text=True
    ).strip()
    if not process_id.isdigit() or int(process_id) == 0:
        raise RuntimeError(f"{service} must be running to capture its configuration.")
    process = Path("/proc") / process_id
    environment = dict(
        item.decode().split("=", 1)
        for item in (process / "environ").read_bytes().split(b"\0")
        if b"=" in item
    )
    script = str(Path(sys.argv[0]).resolve())
    arguments = list(sys.argv[1:])
    position = arguments.index("--service")
    del arguments[position : position + 2]
    os.chdir((process / "cwd").resolve())
    # PYTHONPATH must exist before the new interpreter initializes sys.path.
    environment["PYTHONPATH"] = os.pathsep.join(
        [os.getcwd(), environment.get("PYTHONPATH", "")]
    )
    os.execve(sys.executable, [sys.executable, "-B", script, *arguments], environment)
