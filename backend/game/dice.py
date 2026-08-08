"""Async HTTP client for the Elixir dice service.

The dice service (dice_service/) is the single source of dice values for
online games. It runs at DICE_SERVICE_URL (default http://127.0.0.1:4000).

This client is strict by design: if the service is unreachable or returns a
bad response we raise DiceServiceError rather than falling back to local
randomness, so a broken dice service is always visible.
"""

import logging

import httpx
from decouple import config

logger = logging.getLogger(__name__)

DICE_SERVICE_URL = config('DICE_SERVICE_URL', default='http://127.0.0.1:4000')
DICE_TIMEOUT_SECONDS = 2.0


class DiceServiceError(Exception):
    """Raised when the dice service is unreachable or returns bad data."""


async def fetch_dice(dice_type: str) -> tuple[int, int]:
    """Fetch two dice from the Elixir service.

    `dice_type` is either "opening" (no doubles) or "normal" (doubles allowed).
    Returns (a, b). Raises DiceServiceError on any failure.
    """
    if dice_type not in ("opening", "normal"):
        raise ValueError(f"Unknown dice type: {dice_type}")

    url = f"{DICE_SERVICE_URL}/roll"
    try:
        async with httpx.AsyncClient(timeout=DICE_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params={"type": dice_type})
    except httpx.HTTPError as exc:
        logger.error("Dice service request failed: %s", exc)
        raise DiceServiceError(f"Dice service unreachable: {exc}") from exc

    if response.status_code != 200:
        logger.error(
            "Dice service returned %s for type=%s body=%s",
            response.status_code,
            dice_type,
            response.text,
        )
        raise DiceServiceError(
            f"Dice service returned status {response.status_code}"
        )

    try:
        data = response.json()
        dice = data["dice"]
        a, b = int(dice[0]), int(dice[1])
        if not (1 <= a <= 6 and 1 <= b <= 6):
            raise ValueError("dice out of range")
        if dice_type == "opening" and a == b:
            raise ValueError("opening roll returned doubles")
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        logger.error("Bad dice response body=%s", response.text)
        raise DiceServiceError(f"Bad dice service response: {exc}") from exc

    return a, b


async def fetch_opening_dice() -> tuple[int, int]:
    """Two dice for the opening roll — guaranteed different values."""
    return await fetch_dice("opening")


async def fetch_turn_dice() -> tuple[int, int]:
    """Two dice for a normal turn — doubles allowed."""
    return await fetch_dice("normal")