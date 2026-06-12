"""Anthropic Messages API adapter (official ``anthropic`` SDK, metered).

The hosted counterpart of the subscription-billed Claude CLI provider: same
text-in/text-out contract, but per-token billing with usage + cost stamped on
every result for the metering ledger.
"""

from __future__ import annotations

import os
from typing import Any

from ..base import LLMResult, TextProvider, load_local_env, price_usd


class AnthropicProvider(TextProvider):
    name = "anthropic"

    def _resolved_key(self) -> str | None:
        if self.api_key:
            return self.api_key
        load_local_env()
        return os.getenv("ANTHROPIC_API_KEY") or None

    def available(self) -> bool:
        if not self._resolved_key():
            return False
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False
        return True

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
