"""Job fit and salary estimation pipeline."""

import os as _os

# Cold-start cost (ADR 0003: every request that needs the engine spawns a fresh
# interpreter). On the first model class it builds, pydantic looks for third-party
# plugins by scanning the entry points of EVERY installed distribution
# (pydantic/plugin/_loader.py). kp declares no pydantic plugin, and the scan cost
# ~50 ms per spawn on a developer machine with ~580 distributions — the largest
# single item in the import of pipeline.jobfit.models. Turned off here, before any
# submodule can build a model. ``setdefault``: an operator who sets the variable
# themselves (an empty value re-enables discovery) keeps their choice.
# Guarded by tests/test_cli_import_weight.py.
_os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")
