"""Ollama adapter — local/on-box inference through Ollama's OpenAI-compatible
``/v1`` endpoint. Inherits the OpenAI chat-completions call and the base's
prompt-embedded JSON guard; only the default endpoint and the keyless
availability rule differ.

Models are addressed by their Ollama tag (``lfm2.5:8b``, ``qwen2.5:14b-instruct``)
so ``ollama`` carries no built-in default model — a tag is always explicit
(capabilities.DEFAULT_MODELS["ollama"] = None). Keyless by design: availability
rides on the SDK being importable, and under KP_OFFLINE the default loopback
endpoint stays usable (an off-box OLLAMA_BASE_URL is sealed off by the base's
egress guard, same as the other adapters)."""

from __future__ import annotations

import os

# Re-exported so the base's ``_load_env`` dispatch (and tests that patch it on this
# module) resolve it here — same reason openai_api re-exports it.
from ..base import load_local_env  # noqa: F401
from .openai_api import OpenAIProvider

_DEFAULT_BASE_URL = "http://localhost:11434/v1"


class OllamaProvider(OpenAIProvider):
    name = "ollama"
    # No key env: a stock Ollama server authenticates nothing. A configured
    # apiKey (e.g. an authenticating proxy in front of Ollama) still flows
    # through the inherited _make_client.
    _env_keys = ()

    def _resolved_base_url(self) -> str:
        """Configured base URL → OLLAMA_BASE_URL env → the stock local server."""
        if self.base_url:
            return self.base_url
        self._load_env()
        return os.getenv("OLLAMA_BASE_URL") or _DEFAULT_BASE_URL

    def available(self) -> bool:
        # A base URL always resolves (loopback default), so the inherited
        # OpenAIProvider.available() already lands on the right rule: offline
        # egress check first, then SDK import — never a key requirement.
        return super().available()
