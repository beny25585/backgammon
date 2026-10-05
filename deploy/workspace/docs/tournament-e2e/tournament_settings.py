"""Production checks and the selected real database, scoped to a disposable run."""
from e2e_common import isolated_settings, runtime_config, tournament_common_without_local_env

_config = runtime_config("tournament")
_common = tournament_common_without_local_env()
globals().update({key: value for key, value in vars(_common).items() if key.isupper()})
globals().update(isolated_settings(_config, "tournament"))
