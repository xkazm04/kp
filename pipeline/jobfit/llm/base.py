"""Provider-agnostic core of the multi-LLM layer.

`TextProvider` is duck-type compatible with `ClaudeCliProvider` — the same
`available()` / `complete()` / `complete_json()` / `map()` surface — so call
sites that already accept "a provider object" (match_reasoning.generate,
automation.run_task) work with every adapter unchanged.

Shared here, once, instead of per adapter: bounded retry on transient errors
(the policy proven in gemini.py), the JSON-extraction guard prompt, batch
`map()`, and usage/cost normalization.
"""

from __future__ import annotations

import dataclasses
import random
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from ..claude_cli import _extract_json
from . import monitor

DEFAULT_TIMEOUT_S = 180
# The wrapped use cases return deliberately short JSON (sub-KB rationales,
# decisions, drafts) — this is a cost cap, not a guess; raise per use case via
# KP_LLM_CONFIG params.maxTokens when a use case needs room.
DEFAULT_MAX_TOKENS = 2048

_MAX_ATTEMPTS = 3

# USD per million tokens (input, output) for models whose list price we know.
# Used to stamp cost_usd on results; unknown models carry cost_usd=None and are
# still metered by token counts in the ledger.
MTOK_PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-8": (5.00, 25.00),
}


def price_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    for prefix, (price_in, price_out) in MTOK_PRICES.items():
        if model.startswith(prefix):
            return round((input_tokens * price_in + output_tokens * price_out) / 1_000_000, 6)
    return None


def load_local_env() -> None:
    """Best-effort .env.local/.env loading so adapter keys behave like
    GEMINI_API_KEY does today (gemini.load_local_env), without importing the
    gemini module (and its google-genai dependency) from every adapter."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    root = Path(__file__).resolve().parents[3]
    load_dotenv(root / ".env.local", override=False)
    load_dotenv(root / ".env", override=False)


class LLMError(RuntimeError):
    """Raised for provider failures (after retries), bad config, or junk output."""

    def __init__(self, message: str, *, provider: str | None = None, subtype: str | None = None):
        super().__init__(message)
        self.provider = provider
        self.subtype = subtype


@dataclass(frozen=True)
class LLMResult:
    """One completion: the answer text plus normalized envelope metadata.

    A superset of what callers read off ClaudeResult — `.text`, `.json()`,
    `.cost_usd`, `.usage` — plus the provider/model that actually served it,
    which the usage ledger records.
    """

    text: str
    provider: str
    model: str
    raw: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    cost_usd: float | None = None
    duration_ms: int = 0

    def json(self) -> Any:
        """Parse ``text`` as JSON (tolerates markdown fences / surrounding prose)."""
        return _extract_json(self.text)


def is_transient_error(exc: Exception) -> bool:
    """True for retryable failures (rate limit, 5xx, network timeout) — NOT
    auth / 4xx / bad-request, which are permanent and should fail fast.
    Same policy as gemini._is_transient_error, generalized across SDKs."""
    code = getattr(exc, "code", None)
    if not isinstance(code, int):
        code = getattr(exc, "status_code", None)
    if isinstance(code, int) and code in {408, 429, 500, 502, 503, 504, 529}:
        return True
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(
        marker in text
        for marker in (
            "rate limit", "rate_limit", "resource_exhausted", "unavailable",
            "deadline_exceeded", "overloaded", "429", "502", "503", "504", "529",
            "timeout", "timed out", "temporarily",
        )
    )


class TextProvider:
    """Base adapter: subclasses implement ``available()`` and ``_call()``.

    ``_call`` performs exactly one provider request and returns an
    :class:`LLMResult`; retries, timing, JSON guarding, and batching live here.
    """

    name = "base"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        use_case: str | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.max_tokens = max_tokens
        # Telemetry label only — the registry stamps which use case this
        # instance serves so LightTrack events carry the operation.
        self.use_case = use_case

    # -- to implement ---------------------------------------------------------

    def available(self) -> bool:
        raise NotImplementedError

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        raise NotImplementedError

    # -- shared surface (ClaudeCliProvider-compatible) ------------------------

    def complete(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
    ) -> LLMResult:
        if not prompt or not prompt.strip():
            raise ValueError("prompt must be non-empty")
        budget = timeout or self.timeout
        first_started = time.monotonic()

        def _elapsed_ms() -> int:
            return int((time.monotonic() - first_started) * 1000)

        last: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            started = time.monotonic()
            try:
                result = self._call(prompt, system=system, timeout=budget)
                if not result.duration_ms:
                    result = dataclasses.replace(
                        result, duration_ms=int((time.monotonic() - started) * 1000)
                    )
                monitor.emit_result(
                    provider=self.name,
                    model=self.model,
                    use_case=self.use_case,
                    usage=result.usage,
                    cost_usd=result.cost_usd,
                    duration_ms=result.duration_ms,
                )
                return result
            except LLMError as exc:
                # adapter-level permanent error (bad config, refusal) — no retry
                monitor.emit_error(
                    provider=self.name, model=self.model, use_case=self.use_case,
                    error=exc, duration_ms=_elapsed_ms(),
                )
                raise
            except Exception as exc:  # noqa: BLE001 — classified below
                last = exc
                if attempt == _MAX_ATTEMPTS - 1 or not is_transient_error(exc):
                    monitor.emit_error(
                        provider=self.name, model=self.model, use_case=self.use_case,
                        error=exc, duration_ms=_elapsed_ms(),
                    )
                    raise LLMError(
                        f"{self.name} call failed: {type(exc).__name__}: {exc}",
                        provider=self.name,
                    ) from exc
                time.sleep(0.5 * (2**attempt) + random.uniform(0, 0.25))
        raise LLMError(  # pragma: no cover — the loop always returns or raises
            f"{self.name} call failed: {last}", provider=self.name
        )

    def complete_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
        expected_keys: Sequence[str] | None = None,
    ) -> Any:
        """Run a prompt expected to return JSON and parse it (object or array).

        Mirrors ClaudeCliProvider.complete_json: terse 'JSON only' guard, then
        extract the last complete JSON value, ``expected_keys`` pinning the
        answer object even if the model echoes an example alongside it.
        """
        guarded = (
            f"{prompt}\n\n"
            "Respond with ONLY valid JSON — no markdown fences, no commentary."
        )
        result = self.complete(guarded, system=system, timeout=timeout)
        try:
            return _extract_json(result.text, expected_keys=expected_keys)
        except ValueError as exc:
            raise LLMError(
                f"{self.name} did not return parseable JSON: {result.text[:300]!r}",
                provider=self.name,
            ) from exc

    def map(
        self,
        prompts: Sequence[str],
        *,
        system: str | None = None,
        max_workers: int = 4,
        return_exceptions: bool = True,
    ) -> list[LLMResult | LLMError]:
        """Run many prompts concurrently; preserves order. With
        ``return_exceptions`` (default) a failed item yields its LLMError
        instead of aborting the whole batch."""
        prompts = list(prompts)
        if not prompts:
            return []
        workers = max(1, min(max_workers, len(prompts)))

        def _one(p: str) -> LLMResult | LLMError:
            try:
                return self.complete(p, system=system)
            except Exception as exc:  # noqa: BLE001 — wrapped per the map contract
                if return_exceptions:
                    if isinstance(exc, LLMError):
                        return exc
                    return LLMError(f"{type(exc).__name__}: {exc}", provider=self.name)
                raise

        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(_one, prompts))
