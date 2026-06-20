"""OpenAI Chat Completions adapter (official ``openai`` SDK)."""

from __future__ import annotations

from typing import Any

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import LLMResult, TextProvider, load_local_env, price_usd  # noqa: F401


class OpenAIProvider(TextProvider):
    name = "openai"
    _env_keys = ("OPENAI_API_KEY",)
    _sdk_module = "openai"

    def _make_client(self, timeout: int) -> Any:
        import openai

        # max_retries=0: TextProvider.complete owns the retry policy.
        return openai.OpenAI(
            api_key=self._resolved_key(), timeout=float(timeout), max_retries=0
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
            raw={
                "id": getattr(resp, "id", None),
                "finish_reason": getattr(choice, "finish_reason", None) if choice else None,
            },
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
