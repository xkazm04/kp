"""Anthropic Messages API adapter (official ``anthropic`` SDK, metered).

The hosted counterpart of the subscription-billed Claude CLI provider: same
text-in/text-out contract, but per-token billing with usage + cost stamped on
every result for the metering ledger.
"""

from __future__ import annotations

from typing import Any

# load_local_env imported so the base's _load_env dispatch (and the tests that
# patch it on this module) resolve it here; _resolved_key/available live in base.
from ..base import LLMResult, TextProvider, load_local_env, price_usd  # noqa: F401


class AnthropicProvider(TextProvider):
    name = "anthropic"
    _env_keys = ("ANTHROPIC_API_KEY",)
    _sdk_module = "anthropic"

    def _make_client(self, timeout: int) -> Any:
        import anthropic

        # max_retries=0: TextProvider.complete owns the retry policy, one place
        # for backoff/attempt accounting across all providers.
        return anthropic.Anthropic(
            api_key=self._resolved_key(), timeout=float(timeout), max_retries=0
        )

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        client = self._make_client(timeout)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system and system.strip():
            kwargs["system"] = system.strip()
        resp = client.messages.create(**kwargs)

        text = "".join(
            getattr(block, "text", "") or ""
            for block in (resp.content or [])
            if getattr(block, "type", "") == "text"
        )
        usage = getattr(resp, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        cached = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        return LLMResult(
            text=text,
            provider=self.name,
            model=self.model,
            raw={
                "id": getattr(resp, "id", None),
                "stop_reason": getattr(resp, "stop_reason", None),
            },
            usage={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cached_tokens": cached,
            },
            cost_usd=price_usd(self.model, input_tokens, output_tokens),
        )
