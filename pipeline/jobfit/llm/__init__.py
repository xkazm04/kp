"""Multi-provider LLM layer (docs/architecture/llm-provider-layer.md).

`resolve_provider(use_case)` returns a ClaudeCliProvider-compatible object —
same `available()` / `complete()` / `complete_json()` / `map()` surface — routed
per the `KP_LLM_CONFIG` env JSON the TS side resolves from the DB. With no
config present it returns the Claude CLI provider, so local-dev behavior is
unchanged.
"""

from .base import LLMError, LLMResult, TextProvider
from .monitor import emit_deterministic
from .registry import provider_availability, resolve_provider

__all__ = [
    "LLMError",
    "LLMResult",
    "TextProvider",
    "emit_deterministic",
    "provider_availability",
    "resolve_provider",
]
