"""jobfit test suite.

Suite-wide hermeticity guard so the test suite can never emit to a real
LightTrack server — whether the URL comes from the developer's ``.env.local`` or
a test that sets it explicitly. Two layers, both installed here before any test
module imports (the parent packages import nothing eager, and this runs under
both ``python -m unittest discover`` — the CI runner — and pytest):

1. Neutralize ``.env.local`` loading. ``monitor._client()`` activates LightTrack
   when ``LIGHTTRACK_URL`` is set, and it (like ``gemini.py`` at import time)
   calls a ``load_local_env()`` that reads ``.env.local`` via
   ``dotenv.load_dotenv``. Once observability is on for local dev
   (``LIGHTTRACK_URL`` in ``.env.local`` — the documented setup), that would flip
   telemetry on mid-test. CI never sees this (no ``.env.local``), and tests pass
   there, so nothing depends on the file — patching ``dotenv.load_dotenv`` (not
   one ``load_local_env``) covers ``base`` and ``gemini`` alike and survives the
   pop-then-reload dance the "disabled" telemetry tests do. This keeps the
   env-gating assertions correct.

2. Stub the SDK. Some tests (bench, enabled-path) set ``LIGHTTRACK_URL`` in
   ``os.environ`` themselves and use the real client; with the SDK installed for
   local dev that POSTs to a running server. Route ``lighttrack.LightTrack``
   through a no-network stub so no test can emit, regardless of how the URL got
   set. Best-effort telemetry means nothing asserts on a real POST (it can't —
   CI has no server), so this changes no outcome. Tests that assert on emission
   (test_llm_monitor) inject their own stub over this one for their scope.
"""

import os
import sys
import types
from unittest import mock as _mock

# Layer 1 — clear any ambient value, then stop .env.local from reintroducing it.
# Started for the lifetime of the test process (the process is the test run).
os.environ.pop("LIGHTTRACK_URL", None)
_mock.patch("dotenv.load_dotenv", lambda *args, **kwargs: False).start()


# Layer 2 — a no-network stand-in for the LightTrack SDK.
class _NoNetworkLightTrack:
    def __init__(self, *args, **kwargs):
        pass

    def track(self, *args, **kwargs):
        pass

    def flush(self, *args, **kwargs):
        pass

    def close(self, *args, **kwargs):
        pass


_stub = types.ModuleType("lighttrack")
_stub.LightTrack = _NoNetworkLightTrack
sys.modules["lighttrack"] = _stub
