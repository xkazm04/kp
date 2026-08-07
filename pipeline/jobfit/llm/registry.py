"""Use case → provider resolution.

``resolve_provider("match_reasoning")`` reads KP_LLM_CONFIG and returns a
configured adapter; with no config (local dev) it returns ClaudeCliProvider,
preserving today's behavior exactly. Callers keep their existing dance::

    provider = None if args.no_llm else resolve_provider("match_reasoning", timeout=120)
    if provider is not None and not provider.available():
        provider = None   # → deterministic fallback

Adapters report missing keys/SDKs through ``available()`` (runtime degradation
→ deterministic path); *misconfiguration* — unknown provider, capability
mismatch, missing required model — raises LLMError instead, because silently
serving a different engine than configured is worse than failing the request.
"""

from __future__ import annotations

from typing import Any

from .adapters import ADAPTERS
from .base import DEFAULT_TIMEOUT_S, LLMError
from .capabilities import PROVIDER_CAPABILITIES, default_model, unsupported_caps
from .config import load_config
from .monitor import MonitoredClaudeCli


def resolve_provider(use_case: str, *, timeout: int | None = None) -> Any:
    """Provider instance for ``use_case`` (ClaudeCliProvider-compatible)."""
    cfg = load_config()
    entry = cfg.for_use_case(use_case) if cfg else None

    if entry is not None:
        provider_name = entry.provider
        if provider_name not in PROVIDER_CAPABILITIES:
            raise LLMError(
                f"unknown LLM provider {provider_name!r} for use case {use_case!r} "
                f"(known: {sorted(PROVIDER_CAPABILITIES)})"
            )
        missing = unsupported_caps(use_case, provider_name)
        if missing:
            raise LLMError(
                f"provider {provider_name!r} cannot serve {use_case!r}: "
                f"missing capabilities {sorted(missing)}"
            )

    if entry is None or entry.provider == "claude_cli":
        cli_timeout = (entry.timeout_s if entry else None) or timeout or DEFAULT_TIMEOUT_S
        cli_model = entry.model if entry else None
        # MonitoredClaudeCli IS-A ClaudeCliProvider — identical behavior plus
        # LightTrack emission when observability is configured (monitor.py).
        return MonitoredClaudeCli(model=cli_model, timeout=cli_timeout, use_case=use_case)

    provider_name = entry.provider

    model = entry.model or default_model(use_case, provider_name)
    if not model:
        raise LLMError(
            f"provider {provider_name!r} needs an explicit model for {use_case!r} "
            "(no built-in default — e.g. Azure deployments are customer-named)"
        )

    keys = cfg.keys.get(provider_name) if cfg else None
    kwargs: dict[str, Any] = {
        "model": model,
        "api_key": keys.api_key if keys else None,
        "timeout": entry.timeout_s or timeout or DEFAULT_TIMEOUT_S,
        "use_case": use_case,
    }
    if entry.max_tokens:
        kwargs["max_tokens"] = entry.max_tokens
    if provider_name == "azure_openai":
        kwargs["endpoint"] = keys.endpoint if keys else None
        kwargs["api_version"] = keys.api_version if keys else None
    elif provider_name == "openai":
        # Optional OpenAI-compatible self-hosted endpoint (E-SH-5). None here lets
        # the adapter fall back to the OPENAI_BASE_URL env (the DB-less self-host path).
        kwargs["base_url"] = keys.base_url if keys else None

    return ADAPTERS[provider_name](**kwargs)
