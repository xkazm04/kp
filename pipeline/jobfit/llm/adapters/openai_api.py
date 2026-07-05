"""OpenAI Chat Completions adapter (official ``openai`` SDK).

Also serves any **OpenAI-compatible** endpoint via ``base_url`` — the enterprise
self-host path (docs/SELF_HOSTING.md, E-SH-5): point it at Azure OpenAI's
OpenAI-compatible gateway, vLLM, Ollama (``/v1``), LiteLLM, or an in-VPC proxy so
inference never leaves the customer's network. The base URL comes from
``KP_LLM_CONFIG`` (keys.<provider>.baseUrl) or the ``OPENAI_BASE_URL`` env var; such
endpoints frequently need no API key, so availability rides on the endpoint, not a
key (a placeholder key is supplied to the SDK, which requires a non-empty value)."""

from __future__ import annotations

import os
from typing import Any

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, LLMResult, TextProvider, load_local_env, price_usd  # noqa: F401


class OpenAIProvider(TextProvider):
    name = "openai"
    _env_keys = ("OPENAI_API_KEY",)
    _sdk_module = "openai"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        base_url: str | None = None,
        use_case: str | None = None,
    ) -> None:
        super().__init__(model=model, api_key=api_key, timeout=timeout, max_tokens=max_tokens, use_case=use_case)
        # Optional OpenAI-compatible endpoint (self-hosted / in-VPC inference).
        self.base_url = base_url

    def _resolved_base_url(self) -> str | None:
        """Configured base URL → OPENAI_BASE_URL env → None (api.openai.com)."""
        if self.base_url:
            return self.base_url
        self._load_env()
        return os.getenv("OPENAI_BASE_URL") or None

    def available(self) -> bool:
        # A self-hosted OpenAI-compatible endpoint may require no key (vLLM/Ollama),
        # so when one is configured, availability rides on the SDK being importable
        # rather than a resolved key. The default OpenAI path still requires a key.
        if self._resolved_base_url():
            return self._import_sdk()
        return super().available()

    def _make_client(self, timeout: int) -> Any:
        import openai

        base_url = self._resolved_base_url()
        # max_retries=0: TextProvider.complete owns the retry policy. The SDK rejects
        # a missing api_key even for keyless local endpoints, so pass a placeholder
        # when none is configured and a base_url is in play.
        return openai.OpenAI(
            api_key=self._resolved_key() or ("not-needed" if base_url else None),
            base_url=base_url,
            timeout=float(timeout),
            max_retries=0,
        )

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        client = self._make_client(timeout)
        messages: list[dict[str, str]] = []
        if system and system.strip():
            messages.append({"role": "system", "content": system.strip()})
        messages.append({"role": "user", "content": prompt})

        resp = client.chat.completions.create(
            model=self.model,
            messages=messages,
            # max_completion_tokens (not the legacy max_tokens) — required by
            # reasoning-class models and accepted by the rest.
            max_completion_tokens=self.max_tokens,
        )

        choice = resp.choices[0] if getattr(resp, "choices", None) else None
        text = (getattr(getattr(choice, "message", None), "content", None) or "") if choice else ""
        usage = getattr(resp, "usage", None)
        input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        details = getattr(usage, "prompt_tokens_details", None)
        cached = int(getattr(details, "cached_tokens", 0) or 0)
        return LLMResult(
            text=text,
            provider=self.name,
            model=self.model,
            usage={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cached_tokens": cached,
            },
            # Stamp cost when the model is priced (base.MTOK_PRICES). Azure
            # subclasses this _call but its deployment-name models don't prefix-
            # match, so they stay cost_usd=None by design (priced server-side).
            cost_usd=price_usd(self.model, input_tokens, output_tokens),
        )
