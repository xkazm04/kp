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

import os
from typing import Any

from .adapters import ADAPTERS
from .base import DEFAULT_TIMEOUT_S, LLMError
from .capabilities import PROVIDER_CAPABILITIES, default_model, unsupported_caps
from .config import LLMConfig, load_config
from .monitor import MonitoredClaudeCli


def _production_gemini_default(use_case: str, cfg: LLMConfig | None, timeout: int | None) -> Any | None:
    """Cloud/non-dev default when NO use-case config exists: prefer the Gemini
    Flash tier over the Claude CLI (which rarely exists on a cloud box) — but
    only when Gemini can actually serve (key + SDK resolve; ``available()`` also
    honors KP_OFFLINE). A keyless self-hosted ``next start`` therefore keeps the
    unchanged CLI default. Dev (no NODE_ENV=production) is never affected.
    Explicit routing — a config row, including ``claude_cli`` — always wins
    before this is consulted."""
    if os.getenv("NODE_ENV") != "production":
        return None
    # Never hand a text-only adapter a use case it can't serve (cv_analysis /
    # profile_extract need file_input — those keep their dedicated gemini.py path).
    if unsupported_caps(use_case, "gemini"):
        return None
    keys = cfg.keys.get("gemini") if cfg else None
    provider = ADAPTERS["gemini"](
        model=default_model(use_case, "gemini"),
        api_key=keys.api_key if keys else None,
        timeout=timeout or DEFAULT_TIMEOUT_S,
        use_case=use_case,
    )
    return provider if provider.available() else None


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
        if entry is None:
            gemini = _production_gemini_default(use_case, cfg, timeout)
            if gemini is not None:
                return gemini
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
    elif provider_name in ("openai", "ollama", "qwen"):
        # Optional OpenAI-compatible endpoint override (E-SH-5). None here lets the
        # adapter fall back to its env var (OPENAI_BASE_URL / OLLAMA_BASE_URL) — for
        # ollama the adapter then defaults to the stock local server on :11434.
        kwargs["base_url"] = keys.base_url if keys else None

    return ADAPTERS[provider_name](**kwargs)
