"""Qwen Cloud adapter — Alibaba's model marketplace (qwencloud.com / DashScope
international) through its OpenAI compatible-mode endpoint. One key serves the
Qwen family plus hosted third-party models (``deepseek-v4-flash-0731``, …), so
like OpenRouter it is a "many models through one key" gateway: models are
addressed by slug and there is no built-in default
(capabilities.DEFAULT_MODELS["qwen"] = None).

Inherits the OpenAI chat-completions call and the base's prompt-embedded JSON
guard; only the endpoint and key env vars differ."""

from __future__ import annotations

import os

# Re-exported so the base's ``_load_env`` dispatch (and tests that patch it on this
# module) resolve it here — same reason openai_api re-exports it.
from ..base import load_local_env  # noqa: F401
from .openai_api import OpenAIProvider

_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"


class QwenProvider(OpenAIProvider):
    name = "qwen"
    _env_keys = ("QWEN_API_KEY", "DASHSCOPE_API_KEY")

    def _resolved_base_url(self) -> str:
        """Fixed compatible-mode endpoint; an explicit ``base_url`` /
        ``QWEN_BASE_URL`` wins (mainland endpoint or a proxy)."""
        if self.base_url:
            return self.base_url
        self._load_env()
        return os.getenv("QWEN_BASE_URL") or _DEFAULT_BASE_URL

    def available(self) -> bool:
        # Like OpenRouter: a cloud gateway that ALWAYS needs a key — availability
        # rides on the key, not just the SDK import. _offline_blocked() (base)
        # seals off the cloud host under KP_OFFLINE.
        if self._offline_blocked():
            return False
        return bool(self._resolved_key()) and self._import_sdk()
