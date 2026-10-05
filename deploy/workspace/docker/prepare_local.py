"""Create a private, disposable local environment without importing host credentials."""

import base64
import json
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

DESTINATION = Path("/setup")


def create(name, content):
    path = DESTINATION / name
    if path.exists():
        return
    with path.open("x", encoding="utf-8") as output:
        output.write(content + "\n")
    # Compose bind-mounts individual secret files into containers with different
    # service UIDs. Restrict the host directory, rather than making files unreadable
    # to the granted containers (Compose cannot remap ownership of file secrets).
    path.chmod(0o644)


def main():
    DESTINATION.mkdir(exist_ok=True)
    DESTINATION.chmod(0o700)
    expected = (
        "postgres_password",
        "game_password",
        "tournaments_password",
        "analysis_password",
        "game.json",
        "tournaments.json",
        "analysis.json",
    )
    existing = [name for name in expected if (DESTINATION / name).exists()]
    if existing:
        if len(existing) != len(expected):
            raise RuntimeError(
                "Incomplete Docker secrets; inspect .local before retrying."
            )
        print("Existing Docker secrets preserved.")
        return
    for name in expected[:4]:
        create(name, secrets.token_urlsafe(40))
    ticket, result, command, analysis_token = (
        secrets.token_urlsafe(48) for _ in range(4)
    )
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )

    def encode(value):
        return base64.urlsafe_b64encode(value).decode().rstrip("=")

    configuration = {
        "game": {
            "SECRET_KEY": secrets.token_urlsafe(48),
            "GAMELINK_TICKET_SECRETS": ticket,
            "GAMELINK_RESULT_SECRET": result,
            "GAMELINK_COMMAND_SECRETS": command,
            "ANALYSIS_API_TOKEN": analysis_token,
        },
        "tournaments": {
            "SECRET_KEY": secrets.token_urlsafe(48),
            "GAMELINK_TICKET_SECRET": ticket,
            "GAMELINK_RESULT_SECRETS": result,
            "GAMELINK_COMMAND_SECRET": command,
            "ANALYSIS_API_TOKEN": analysis_token,
            "WEB_PUSH_PUBLIC_KEY": encode(public),
            "WEB_PUSH_PRIVATE_KEY": encode(private),
            "WEB_PUSH_SUBJECT": "mailto:developer@localhost",
        },
        "analysis": {
            "SECRET_KEY": secrets.token_urlsafe(48),
            "ANALYSIS_API_TOKEN": analysis_token,
        },
    }
    for service, values in configuration.items():
        create(f"{service}.json", json.dumps(values))
    print(
        "Private Docker secrets created. No host database or credentials were imported."
    )


if __name__ == "__main__":
    main()
