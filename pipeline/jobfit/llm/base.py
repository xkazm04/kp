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
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from ..claude_cli import _extract_json
from . import monitor
from .offline import is_local_url, is_offline

DEFAULT_TIMEOUT_S = 180
# The wrapped use cases return deliberately short JSON (sub-KB rationales,
# decisions, drafts) — this is a cost cap, not a guess; raise per use case via
# KP_LLM_CONFIG params.maxTokens when a use case needs room.
DEFAULT_MAX_TOKENS = 2048

_MAX_ATTEMPTS = 3
# The configured timeout is a TOTAL wall-clock ceiling across all retries. When
# fewer than this many seconds remain before that deadline, stop instead of
# starting (or sleeping into) an attempt that would run past it — so the total
# never blows out to ~_MAX_ATTEMPTS × timeout (which the TS spawn kill would
# SIGKILL mid-call, losing the metering ledger line for spend that DID occur).
_MIN_ATTEMPT_S = 1.0

# USD per million tokens (input, output) for models whose list price we know.
# Used to stamp cost_usd on results; unknown models carry cost_usd=None and are
# still metered by token counts in the ledger.
#
# Coverage contract: EVERY model the registry can route to by default —
# capabilities.DEFAULT_MODELS ∪ USE_CASE_MODEL_OVERRIDES — must prefix-match a row
# here, or that provider's traffic silently escapes cost accounting (cost_usd=None).
# test_llm_base.py asserts this. Prefix match means a dated/suffixed variant
# (e.g. "claude-haiku-4-5-20251001") inherits its family's price.
#
# NOTE on the non-Anthropic rows: these are LOCAL ESTIMATES (flash/mini tier list
# prices), not contractual rates — verify against each provider's price book before
# billing on them. LightTrack prices server-side from its own price book and is the
# source of truth; our cost_usd is the cross-check it compares against (monitor.py).
# Azure deployments are customer-named (no public prefix) so they intentionally stay
# unpriced here and fall back to LightTrack's per-deployment pricing.
MTOK_PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-8": (5.00, 25.00),
    # estimates — confirm against the provider price books (see note above)
    "gemini-3-flash-preview": (0.30, 2.50),
    "gemini-2.5-flash": (0.30, 2.50),
    "gpt-5-mini": (0.25, 2.00),
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
    """Base adapter: subclasses implement ``_call()`` (and a couple of class hooks).

    ``_call`` performs exactly one provider request and returns an
    :class:`LLMResult`; retries, timing, JSON guarding, and batching live here.

    Key/SDK availability is also shared: a subclass declares the env var(s) its
    key can come from in ``_env_keys`` and the SDK module to probe in
    ``_sdk_module``; the base ``_resolved_key()`` / ``available()`` then do the
    same "resolve key → import SDK" dance for every direct adapter, so a new
    provider just sets those two attrs. (Azure overrides ``available()`` to AND
    its endpoint check on top — see ``adapters/azure_openai.py``.)
    """

    name = "base"
    # Env vars an unset api_key falls back to, first-set-wins (empty = no env key).
    _env_keys: tuple[str, ...] = ()
    # SDK module the base ``available()``/``_import_sdk()`` probes for presence.
    _sdk_module: str | None = None

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

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        raise NotImplementedError

    # -- key / SDK availability (shared across the direct adapters) -----------

    def _load_env(self) -> None:
        """Best-effort .env load, dispatched through the adapter's OWN module so a
        per-adapter ``load_local_env`` monkeypatch (tests) still intercepts it."""
        mod = sys.modules.get(type(self).__module__)
        loader = getattr(mod, "load_local_env", load_local_env)
        loader()

    def _resolved_key(self) -> str | None:
        if self.api_key:
            return self.api_key
        self._load_env()
        for env_key in self._env_keys:
            value = os.getenv(env_key)
            if value:
                return value
        return None

    def _import_sdk(self) -> bool:
        """True if the provider SDK is importable. Override for a non-trivial
        import target; the default imports ``_sdk_module`` by name."""
        if not self._sdk_module:
            return True
        try:
            __import__(self._sdk_module)
        except ImportError:
            return False
        return True

    def _offline_egress_url(self) -> str | None:
        """The endpoint this adapter would send prompts to, for the KP_OFFLINE
        on-box check. ``None`` = a fixed cloud host with no configurable on-box
        override (Anthropic, Gemini, api.openai.com) — never local, so never
        allowed offline. OpenAI-compatible adapters override with their resolved
        ``base_url``; Azure with its resource endpoint."""
        return None

    def _allowed_offline(self) -> bool:
        """Whether this adapter may run under KP_OFFLINE. True ONLY when its egress
        endpoint is a genuinely on-box / private host (``offline.is_local_url``): a
        loopback / unix-socket / private-network model server (Ollama, vLLM) stays
        usable; a cloud host — or no configured local endpoint — is sealed off and
        drops to the deterministic fallback. See pipeline/jobfit/llm/offline.py.

        The single seam every egressing adapter inherits: a future adapter that does
        not override ``_offline_egress_url`` is cloud-only and blocked offline by
        default, so the no-egress guarantee cannot be lost by omission."""
        return is_local_url(self._offline_egress_url())

    def _offline_blocked(self) -> bool:
        """The one KP_OFFLINE decision, shared by every adapter's ``available()``
        and by the ``complete()`` egress guard: sealed iff offline is on AND this
        adapter's endpoint would leave the box."""
        return is_offline() and not self._allowed_offline()

    def _assert_offline_egress_allowed(self) -> None:
        """Fail closed with a clear, actionable error (never a silent no-op) when a
        call would egress off-box under KP_OFFLINE — belt-and-suspenders behind
        ``available()`` so even a direct ``complete()`` can never breach the seal."""
        if not self._offline_blocked():
            return
        target = self._offline_egress_url() or f"{self.name}'s default cloud endpoint"
        raise LLMError(
            f"KP_OFFLINE is set (air-gapped no-egress mode), but provider "
            f"{self.name!r} would send prompts to {target!r}, which is not an "
            f"on-box endpoint — refusing to egress candidate data. Point the "
            f"provider at a loopback/on-box model server (e.g. "
            f"http://localhost:11434/v1) or unset KP_OFFLINE.",
            provider=self.name,
            subtype="offline_egress_blocked",
        )

    def available(self) -> bool:
        # Hard no-egress mode: a cloud engine must not fire even if a key is set.
        if self._offline_blocked():
            return False
        if not self._resolved_key():
            return False
        return self._import_sdk()

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
        # Fail closed before any network client is built: a call that would leave
        # the box under KP_OFFLINE raises here rather than egressing candidate data.
        self._assert_offline_egress_allowed()
        budget = timeout or self.timeout
        first_started = time.monotonic()
        # `budget` is the TOTAL wall-clock deadline, not a per-attempt one: derive
        # a monotonic deadline once and give each attempt only the time that
        # REMAINS before it. Previously every one of _MAX_ATTEMPTS attempts got the
        # full `budget`, so three transient timeouts ran ~3× the configured timeout
        # (plus backoff) — outrunning the TS spawn's wall-clock kill, which then
        # SIGKILLed the child mid-call and lost the ledger line.
        deadline = first_started + budget

        def _elapsed_ms() -> int:
            return int((time.monotonic() - first_started) * 1000)

        def _emit_error(exc: Exception) -> None:
            monitor.emit_error(
                provider=self.name, model=self.model, use_case=self.use_case,
                error=exc, duration_ms=_elapsed_ms(),
            )

        last: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            # Overall-deadline gate: stop before starting an attempt that no longer
            # fits in the remaining budget. The FIRST attempt always runs.
            remaining = deadline - time.monotonic()
            if attempt > 0 and remaining <= _MIN_ATTEMPT_S:
                break
            per_attempt = max(_MIN_ATTEMPT_S, int(remaining))
            started = time.monotonic()
            try:
                result = self._call(prompt, system=system, timeout=per_attempt)
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
                _emit_error(exc)
                raise
            except Exception as exc:  # noqa: BLE001 — classified below
                last = exc
                if attempt == _MAX_ATTEMPTS - 1 or not is_transient_error(exc):
                    _emit_error(exc)
                    raise LLMError(
                        f"{self.name} call failed: {type(exc).__name__}: {exc}",
                        provider=self.name,
                    ) from exc
                # Cap the backoff so the sleep itself can't push past the deadline,
                # and never sleep away time the next attempt could have used.
                backoff = 0.5 * (2**attempt) + random.uniform(0, 0.25)
                remaining_after = deadline - time.monotonic()
                if remaining_after <= _MIN_ATTEMPT_S:
                    break
                time.sleep(min(backoff, remaining_after - _MIN_ATTEMPT_S))
        # Deadline exhausted between retries: record the failure in the ledger
        # BEFORE raising (a SIGKILL from the TS wall-clock past the deadline would
        # lose it entirely) so the spend/attempts that DID occur stay attributable.
        err = LLMError(
            f"{self.name} call exhausted its {budget}s deadline after "
            f"{_MAX_ATTEMPTS} attempts: {last}",
            provider=self.name,
            subtype="deadline_exceeded",
        )
        _emit_error(err)
        raise err from last

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
        except ValueError:
            pass  # fall through to one corrective re-prompt before giving up

        # Self-repair: one corrective re-prompt that feeds the unparseable output
        # back and asks for the JSON value alone. A single formatting slip (stray
        # prose, a markdown fence, a trailing comma) would otherwise discard an
        # already-paid completion and silently drop the call site to its
        # deterministic fallback. Bounded to exactly ONE extra call; it goes
        # through complete() so it is retried/metered like any other request.
        repair = (
            "Your previous response could not be parsed as JSON. Return the SAME "
            "answer as a single valid JSON value ONLY — no markdown fences, no "
            "commentary, no leading or trailing text.\n\n"
            f"Previous response:\n{result.text[:4000]}"
        )
        repaired = self.complete(repair, system=system, timeout=timeout)
        try:
            return _extract_json(repaired.text, expected_keys=expected_keys)
        except ValueError as exc:
            err = LLMError(
                f"{self.name} did not return parseable JSON after a repair "
                f"re-prompt: {repaired.text[:300]!r}",
                provider=self.name,
                subtype="unparseable_json",
            )
            # complete() already logged the underlying call(s) as SUCCESS — text WAS
            # returned — but the output is unusable JSON, so also surface an ERROR to
            # LightTrack. Otherwise a corrupted/truncated response reads as a healthy
            # success and the monitoring can't see the call site drop to its
            # deterministic fallback (the provider "responded", just not usably).
            monitor.emit_error(
                provider=self.name,
                model=self.model,
                use_case=self.use_case,
                error=err,
                duration_ms=0,
            )
            raise err from exc

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
