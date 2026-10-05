"""Load only the secrets granted to this container, then replace the entrypoint."""

import json
import os
import sys
from pathlib import Path
from urllib.parse import quote


def main():
    configuration = Path(os.environ["RUNTIME_CONFIG_FILE"])
    values = json.loads(configuration.read_text(encoding="utf-8"))
    if not isinstance(values, dict) or any(
        not isinstance(value, str) for value in values.values()
    ):
        raise ValueError("Runtime configuration must contain string values.")
    os.environ.update(values)
    password = Path(os.environ["DB_PASSWORD_FILE"]).read_text(encoding="utf-8").strip()
    os.environ["DB_PASSWORD"] = password
    os.environ["DATABASE_URL"] = (
        f"postgresql://{quote(os.environ['DB_USER'], safe='')}:{quote(password, safe='')}"
        f"@{os.environ['DB_HOST']}:{os.environ.get('DB_PORT', '5432')}/{os.environ['DB_NAME']}"
    )
    if len(sys.argv) < 2:
        raise ValueError("A service command is required.")
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
