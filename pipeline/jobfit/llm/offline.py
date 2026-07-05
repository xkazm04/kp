"""KP_OFFLINE — hard no-egress mode for air-gapped self-host installs.

E-SH-4 (docs/SELF_HOSTING.md §7). When ``KP_OFFLINE`` is truthy, cloud LLM engines
refuse to run (``available()`` → False → the call site's deterministic fallback),
so nothing reaches api.openai.com / generativelanguage / api.anthropic.com / the
Claude CLI's cloud. Only an explicitly-configured **self-hosted** endpoint (the
OpenAI adapter with a ``base_url``, or Azure with its ``endpoint``) stays usable.

This is the Python half; the TS half guards ``fetch`` at server startup
(app/_lib/offline.ts) so the same flag also blocks GitHub/Polar/voice/JS-SDK egress.
Both are application-level backstops — the ultimate guarantee is a network egress
policy at the deployment layer, which SELF_HOSTING.md recommends alongside this flag.
"""

from __future__ import annotations

import os
from typing import Mapping

_TRUTHY = {"1", "true", "yes", "on"}


def is_offline(env: Mapping[str, str] | None = None) -> bool:
    """True when KP_OFFLINE is set to a truthy value (1/true/yes/on)."""
    value = (env if env is not None else os.environ).get("KP_OFFLINE", "")
    return value.strip().lower() in _TRUTHY
