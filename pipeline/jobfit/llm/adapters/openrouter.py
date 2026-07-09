"""OpenRouter adapter — the OpenAI-compatible gateway: one key, hundreds of models
addressed by slug (``anthropic/claude-sonnet-5``, ``google/gemini-3.5-flash``,
``deepseek/deepseek-v4-flash``, …). Inherits the OpenAI chat-completions call and
the base's prompt-embedded JSON guard; only the endpoint, key env var, and
OpenRouter's optional attribution headers differ.

This is the "many models through one key" path a model-comparison matrix runs on:
target ``openrouter:<slug>`` with ``OPENROUTER_API_KEY`` set. Models are addressed
by their OpenRouter slug, so ``openrouter`` carries no built-in default model — a
slug is always explicit (capabilities.DEFAULT_MODELS["openrouter"] = None)."""

from __future__ import annotations

import os
from typing import Any

# Re-exported so the base's ``_load_env`` dispatch (and tests that patch it on this
# module) resolve it here — same reason openai_api re-exports it.
from ..base import load_local_env  # noqa: F401
from .openai_api import OpenAIProvider

_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterProvider(OpenAIProvider):
    name = "openrouter"
    _env_keys = ("OPENROUTER_API_KEY",)

    def _resolved_base_url(self) -> str | None:
        """Fixed OpenRouter endpoint; an explicit ``base_url`` / ``OPENROUTER_BASE_URL``
        wins (for an OpenRouter-compatible proxy)."""
        if self.base_url:
            return self.base_url
        self._load_env()
        return os.getenv("OPENROUTER_BASE_URL") or _DEFAULT_BASE_URL

    def available(self) -> bool:
        # Unlike a keyless self-hosted OpenAI-compatible endpoint, OpenRouter ALWAYS
        # needs a key — so availability rides on the key, not just the SDK import.
        # _offline_blocked() (base) seals off the default openrouter.ai cloud host
        # under KP_OFFLINE; only an on-box OPENROUTER_BASE_URL would stay usable.
        if self._offline_blocked():
            return False
        return bool(self._resolved_key()) and self._import_sdk()

    def _make_client(self, timeout: int) -> Any:
        import openai

        headers: dict[str, str] = {}
        # OpenRouter's optional attribution headers (skipped when unset).
        if referer := os.getenv("OPENROUTER_SITE_URL"):
            headers["HTTP-Referer"] = referer
        if title := os.getenv("OPENROUTER_APP_NAME"):
            headers["X-Title"] = title
        return openai.OpenAI(
            api_key=self._resolved_key(),
            base_url=self._resolved_base_url(),
            timeout=float(timeout),
            max_retries=0,  # TextProvider.complete owns the retry policy
            default_headers=headers or None,
        )
