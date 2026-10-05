"""Real game settings with no .env imports or non-E2E mutable paths."""
from e2e_common import isolated_settings, runtime_config

_config = runtime_config("game")
# prepare_runtime replaced decouple.config with an environment-only repository.
from backgammon_project.settings import *  # noqa: E402,F403

globals().update(isolated_settings(_config, "game"))
