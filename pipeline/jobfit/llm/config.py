"""KP_LLM_CONFIG parsing.

The TS side owns the DB (llm_config + provider_keys); it resolves rows + keys
into one JSON env var per spawn, so Python has no second source of truth.
Shape::

    {
      "useCases": {
        "match_reasoning": {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",            // optional — defaults per provider
          "params": { "maxTokens": 2048, "timeoutS": 120 }   // optional
        },
        "*": { "provider": "openai" }             // optional wildcard default
      },
      "keys": {
        "anthropic":    { "apiKey": "sk-…" },
        "azure_openai": { "apiKey": "…", "endpoint": "https://…", "apiVersion": "…" }
      }
    }

A malformed config raises (fail loud): silently falling back to a different
provider/model would violate the no-silent-model-drift invariant.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Mapping

from .base import LLMError

ENV_VAR = "KP_LLM_CONFIG"


@dataclass(frozen=True)
class UseCaseConfig:
    provider: str
    model: str | None = None
    max_tokens: int | None = None
    timeout_s: int | None = None


@dataclass(frozen=True)
class ProviderKeys:
    api_key: str | None = None
    endpoint: str | None = None
    api_version: str | None = None


@dataclass(frozen=True)
class LLMConfig:
    use_cases: dict[str, UseCaseConfig] = field(default_factory=dict)
    keys: dict[str, ProviderKeys] = field(default_factory=dict)

    def for_use_case(self, use_case: str) -> UseCaseConfig | None:
        return self.use_cases.get(use_case) or self.use_cases.get("*")


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit() and int(value) > 0:
        return int(value)
    return None


def load_config(env: Mapping[str, str] | None = None) -> LLMConfig | None:
    """Parse KP_LLM_CONFIG from ``env`` (default os.environ). None when unset."""
    raw = (env if env is not None else os.environ).get(ENV_VAR)
    if not raw or not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"{ENV_VAR} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise LLMError(f"{ENV_VAR} must be a JSON object, got {type(payload).__name__}")

    use_cases: dict[str, UseCaseConfig] = {}
    raw_use_cases = payload.get("useCases") or {}
    if not isinstance(raw_use_cases, dict):
        raise LLMError(f"{ENV_VAR}.useCases must be an object")
    for name, entry in raw_use_cases.items():
        if not isinstance(entry, dict) or not str(entry.get("provider") or "").strip():
            raise LLMError(f"{ENV_VAR}.useCases[{name!r}] needs a 'provider'")
        params = entry.get("params") if isinstance(entry.get("params"), dict) else {}
        model = entry.get("model")
        use_cases[str(name)] = UseCaseConfig(
            provider=str(entry["provider"]).strip(),
            model=str(model).strip() if isinstance(model, str) and model.strip() else None,
            max_tokens=_int_or_none(params.get("maxTokens")),
            timeout_s=_int_or_none(params.get("timeoutS")),
        )

    keys: dict[str, ProviderKeys] = {}
    raw_keys = payload.get("keys") or {}
    if not isinstance(raw_keys, dict):
        raise LLMError(f"{ENV_VAR}.keys must be an object")
    for provider, entry in raw_keys.items():
        if not isinstance(entry, dict):
            continue
        keys[str(provider)] = ProviderKeys(
            api_key=str(entry["apiKey"]) if entry.get("apiKey") else None,
            endpoint=str(entry["endpoint"]) if entry.get("endpoint") else None,
            api_version=str(entry["apiVersion"]) if entry.get("apiVersion") else None,
        )

    return LLMConfig(use_cases=use_cases, keys=keys)
