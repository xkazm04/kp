"""LightTrack telemetry for the LLM provider layer (fire-and-forget).

LightTrack (sibling repo ``../LightTrack``) is the self-hosted LLM
observability service this project standardizes on; kp and LightTrack are
developed together toward the prod environment, and this module is the
integration seam. Local development setup, once::

    pip install ../LightTrack/clients/python

then set ``LIGHTTRACK_URL`` (plus ``LIGHTTRACK_KEY`` / ``LIGHTTRACK_PROJECT``
as the deployment needs) in ``.env.local``. Telemetry activates only when BOTH
the package and ``LIGHTTRACK_URL`` are present; every emit is best-effort and
exception-swallowing — a LightTrack outage can never break an LLM call. Cost
is priced server-side from LightTrack's price book; we attach our own
``cost_usd`` (when the adapter knows it) as metadata for cross-checking.
"""

from __future__ import annotations

import os
import time
from typing import Any

from ..claude_cli import ClaudeCliProvider, ClaudeResult

_UNSET = object()
_client_cache: Any = _UNSET

# LightTrack's SDK normalizes provider aliases itself (azure_openai→openai,
# gemini→google). The Claude CLI engine reports as anthropic — the spend is
# Anthropic spend — with an engine tag keeping the billing path distinguishable.
_TRACK_PROVIDER = {"claude_cli": "anthropic"}


def reset() -> None:
    """Forget the cached client (tests; env changes mid-process)."""
    global _client_cache
    _client_cache = _UNSET


def _client() -> Any:
    global _client_cache
    if _client_cache is not _UNSET:
        return _client_cache
    client = None
    try:
        from .base import load_local_env  # function-level: avoids a base↔monitor import cycle

        load_local_env()
        if os.getenv("LIGHTTRACK_URL"):
            from lighttrack import LightTrack

            client = LightTrack(source="kp")
    except Exception:
        client = None  # missing SDK / bad env — observability stays off, app unaffected
    _client_cache = client
    return client


def _tags(provider: str) -> list[str]:
    tags = ["llm-layer"]
    if provider == "claude_cli":
        tags.append("engine:claude_cli")
    return tags


def emit_result(
    *,
    provider: str,
    model: str | None,
    use_case: str | None,
    usage: dict[str, Any] | None,
    cost_usd: float | None = None,
    duration_ms: int | None = None,
) -> None:
    client = _client()
    if client is None:
        return
    try:
        u = usage or {}
        cached = u.get("cached_tokens")
        if cached is None:
            cached = u.get("cache_read_input_tokens")
        client.track(
            _TRACK_PROVIDER.get(provider, provider),
            model,
            input_tokens=int(u.get("input_tokens", 0) or 0),
            output_tokens=int(u.get("output_tokens", 0) or 0),
            cached_input=int(cached) if cached is not None else None,
            operation=use_case,
            latency_ms=duration_ms,
            tags=_tags(provider),
            metadata={"cost_usd": cost_usd} if cost_usd is not None else None,
        )
    except Exception:
        pass  # telemetry must never break the host call


def emit_error(
    *,
    provider: str,
    model: str | None,
    use_case: str | None,
    error: Any,
    duration_ms: int | None = None,
) -> None:
    client = _client()
    if client is None:
        return
    try:
        client.track(
            _TRACK_PROVIDER.get(provider, provider),
            model,
            operation=use_case,
            latency_ms=duration_ms,
            error=str(error)[:500],
            tags=_tags(provider),
        )
    except Exception:
        pass


class MonitoredClaudeCli(ClaudeCliProvider):
    """ClaudeCliProvider + LightTrack emission.

    The registry hands this out so the local-dev default engine shows up in
    observability alongside the metered adapters. ``complete_json``/``map``
    route through ``complete()``, so one logical call emits exactly one event.
    """

    def __init__(self, *args: Any, use_case: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.use_case = use_case

    def complete(self, prompt: str, *, system: str | None = None, timeout: int | None = None) -> ClaudeResult:
        started = time.monotonic()
        try:
            result = super().complete(prompt, system=system, timeout=timeout)
        except Exception as exc:
            emit_error(
                provider="claude_cli",
                model=self.model or "claude-cli-default",
                use_case=self.use_case,
                error=exc,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            raise
        emit_result(
            provider="claude_cli",
            model=self.model or "claude-cli-default",
            use_case=self.use_case,
            usage=result.usage,
            cost_usd=result.cost_usd or None,
            duration_ms=result.duration_ms or int((time.monotonic() - started) * 1000),
        )
        return result
