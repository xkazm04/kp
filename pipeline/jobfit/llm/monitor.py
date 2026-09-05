"""LightTrack telemetry for the LLM provider layer (fire-and-forget).

LightTrack (sibling repo ``../tracklight``) is the self-hosted LLM
observability service this project standardizes on; kp and LightTrack are
developed together toward the prod environment, and this module is the
integration seam. Local development setup, once::

    pip install ../tracklight/clients/python

then set ``LIGHTTRACK_URL`` (plus ``LIGHTTRACK_KEY`` / ``LIGHTTRACK_PROJECT``
as the deployment needs) in ``.env.local``. Telemetry activates only when BOTH
the package and ``LIGHTTRACK_URL`` are present; every emit is best-effort and
exception-swallowing — a LightTrack outage can never break an LLM call. Cost
is priced server-side from LightTrack's price book; we attach our own
``cost_usd`` (when the adapter knows it) as metadata for cross-checking.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

from ..claude_cli import ClaudeCliProvider, ClaudeResult

_UNSET = object()
_client_cache: Any = _UNSET

# Serializes appends to the usage-ledger sidecar so the threaded base.map() path
# (concurrent complete() calls) can't interleave two JSON lines into one.
_ledger_lock = threading.Lock()

# LightTrack's SDK normalizes provider aliases itself (azure_openai→openai,
# gemini→google). The Claude CLI engine reports as anthropic — the spend is
# Anthropic spend — with an engine tag keeping the billing path distinguishable.
_TRACK_PROVIDER = {"claude_cli": "anthropic"}

# Explicit opt-OUT tokens for KP_LLM_USAGE_LOG. Metering is ON BY DEFAULT (the
# spawnPython seam sets the env to a per-call sidecar path for every child), so the
# flagship CV-analysis spend lands in the ledger without any opt-in. An operator who
# genuinely wants NO metering sets KP_LLM_USAGE_LOG to one of these — a real opt-out
# switch rather than a value that would otherwise be misread as a file literally named
# "0". An unset/blank env is also off (nowhere to write), same as before.
_LEDGER_OFF_TOKENS = {"0", "off", "false", "no", "disable", "disabled"}


def _ledger_path() -> str | None:
    """The usage-ledger sidecar path, or None when metering is disabled — either
    unset/blank (nowhere to write) or an explicit opt-out token."""
    raw = os.getenv("KP_LLM_USAGE_LOG")
    if not raw:
        return None
    if raw.strip().lower() in _LEDGER_OFF_TOKENS:
        return None
    return raw


def _request_id() -> str | None:
    """The background-task run this spawn belongs to, set per spawn by the TS
    seam (python-runner.ts) from the ambient task scope. Stamped onto every
    ledger line as ``request_id`` — the join key the Insights → Activity detail
    uses to pull up the run whose output the row produced. Absent when the CLI
    was spawned outside a task (an inline route, a direct CLI run, a test): the
    column stays null, exactly as it was before this was wired."""
    raw = os.getenv("KP_LLM_REQUEST_ID")
    return raw.strip() or None if raw else None


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


# LightTrack's `operation` is a fixed 4-variant enum (chat|completion|embedding|
# other) — an arbitrary string silently deserializes to "other". So the kp
# use_case CANNOT ride on `operation`; it goes on a `use_case:<name>` tag, the
# queryable custom axis (cost_summary groups by provider+model; per-use-case
# slicing is tag-filtered). Every kp call through this seam is a structured
# JSON completion, so operation is uniformly "chat".
#
# LightTrack now also has a first-class `events.name` column (a use-case
# registry keyed on it — see .ai/use-cases.json). The identity already existed
# here as the use_case tag value; `client.track(..., name=use_case)` promotes
# that same string into the field it always should have lived in. The tag
# stays (below) for back-compat with anything still reading it. A call with no
# use_case sends no name — an absent name is honest, a placeholder is not.
_OPERATION = "chat"


def _tags(provider: str, use_case: str | None = None) -> list[str]:
    tags = ["llm-layer"]
    if use_case:
        tags.append(f"use_case:{use_case}")
    if provider == "claude_cli":
        tags.append("engine:claude_cli")
    # Per-tool attribution: the server stores `operation` as a small enum, so a
    # free-form use_case collapses to "other" there. A `tool:<use_case>` tag is
    # how LightTrack groups spend per tool (matches the convention the events UI
    # reads), so the "what does each tool cost" question stays answerable.
    if use_case:
        tags.append(f"tool:{use_case}")
    return tags


# The closed vocabulary for `outcome` — the column every money-shaped aggregate in
# db/llm.ts filters on. "ok" is an attempt that produced a meterable envelope (a real
# completion, or a deterministic template serve, which costs a truthful zero); "failed"
# is an attempt that RAISED, whose token spend the provider never reported back.
# Deliberately two values and not a free-form status: a row class the aggregates do not
# know about is exactly the bug this column exists to prevent.
OUTCOME_OK = "ok"
OUTCOME_FAILED = "failed"

# Why a FAILED attempt failed. Same three-word register as automation.DEGRADATION_REASONS
# and spelled identically where they overlap, so one ledger query counts both halves of
# the same descent — the CLI's deterministic line and the failed attempt underneath it.
# Not imported from automation: that module imports this package, and the vocabularies
# are maintained apart on purpose (that one names why the TEMPLATE served, this one why
# the CALL died).
FAILURE_REASONS: tuple[str, ...] = ("provider_timeout", "unparseable_output", "provider_error")


def _failure_reason(error: Any) -> str:
    """Classify a raised call into FAILURE_REASONS.

    Reads ``LLMError.subtype`` and never the message: the subtype is the part
    base.py maintains as a contract, and the message is provider-authored text that
    has no business in a durable column (it can echo the prompt). Same reading
    ``automation._call_failure_reason`` does, for the same reason."""
    subtype = getattr(error, "subtype", None)
    if subtype == "deadline_exceeded":
        return "provider_timeout"
    if subtype == "unparseable_json":
        return "unparseable_output"
    return "provider_error"


_REASON_CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# The exception TYPE names worth keeping when a prose reason collapses to a code.
# `describe_fallback` writes "<ExceptionType>: <message>"; the type half is ours (a
# Python class name), the message half is the provider's. Mapping the few types that
# name a distinct descent keeps a timeout reading as a timeout instead of flattening
# into the catch-all, without ever storing the message.
_PROSE_TYPE_REASON = {
    "TimeoutError": "provider_timeout",
    "ReadTimeout": "provider_timeout",
    "ConnectTimeout": "provider_timeout",
    "ReadTimeoutError": "provider_timeout",
}


def _reason_code(reason: str | None) -> str | None:
    """Reduce a caller's reason to a CODE before it reaches a durable column.

    Three call sites (campaign, match_reasoning, group_compare) hand their CLI a
    ``provenance.describe_fallback`` line — ``"<ExceptionType>: <message>"`` — and the
    CLI passes it straight to ``emit_deterministic``. That is the right shape for the
    per-request envelope, where a human is reading one failure, and the wrong shape
    for `llm_usage.reason`: the message half is provider-authored text that can echo
    the prompt, and this repo answers a failure with a code, never with the thrown
    message. A prose line collapses to ``provider_error`` — which is not a guess but
    the exact word DEGRADATION_REASONS reserves for "anything else the call raised".
    The finer subtypes still arrive: automation_cli sends its classified
    ``take_degradation_reason``, and ``emit_error`` writes the failed attempt
    underneath with its own ``_failure_reason``."""
    if reason is None:
        return None
    token = reason.strip()
    if not token:
        return None
    if _REASON_CODE.match(token):
        return token
    return _PROSE_TYPE_REASON.get(token.split(":", 1)[0].strip(), "provider_error")


def _append_ledger(
    *,
    provider: str,
    model: str | None,
    use_case: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_tokens: int | None,
    cost_usd: float | None,
    source: str = "llm",
    reason: str | None = None,
    outcome: str = OUTCOME_OK,
) -> None:
    """Append one NDJSON line per metered call to the usage-ledger sidecar named
    by ``KP_LLM_USAGE_LOG`` (set per spawn by the TS spawnPython seam, which folds
    the file into the llm_usage table after the child exits). This is the DURABLE
    spend record and is deliberately INDEPENDENT of LightTrack — it must persist
    even when observability is off (the default deployment). Fire-and-forget and
    fully exception-swallowed: a ledger write can never break the host LLM call.
    Snake_case keys match db/llm.ts ingestLlmUsageLog. ``source`` is "llm" for
    real provider calls (emit_result) and "deterministic" when a CLI's template
    fallback served instead (emit_deterministic) — parseLedgerLine on the TS side
    accepts exactly these two values.

    ``outcome`` separates a meterable attempt from a failed one (OUTCOME_OK /
    OUTCOME_FAILED); ``reason`` names WHY a row is not a plain successful serve.
    Both ride the sidecar and land in columns of the same name — see the
    visible-but-not-billable note on `llm-usage-ledger.ts`."""
    path = _ledger_path()
    if not path:
        return
    try:
        payload: dict[str, Any] = {
            "use_case": use_case,
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_tokens": cached_tokens,
            "cost_usd": cost_usd,
            "source": source,
            "outcome": outcome,
            "request_id": _request_id(),
        }
        code = _reason_code(reason)
        if code is not None:
            # WHY this row is not a plain successful LLM serve. For a deterministic
            # line: the descent ("offline_policy", "not_installed", "disabled",
            # generic "unavailable" at the availability gate; "provider_timeout",
            # "unparseable_output", "unusable_output", "provider_error" mid-call).
            # For a failed line: FAILURE_REASONS. Until this reached a COLUMN the
            # ledger could not tell a keyless install from a provider that answered
            # with prose — the operator saw the same zero-cost line for both.
            payload["reason"] = code
        line = json.dumps(payload, ensure_ascii=False)
        with _ledger_lock, open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass  # ledger I/O must never break the host call


def emit_deterministic(use_case: str | None, *, reason: str | None = None) -> None:
    """Ledger-record a request the DETERMINISTIC template path served — the
    keyless (`provider.available()` false → provider=None) or failed-LLM
    fallback that used to be invisible to the usage ledger (parseLedgerLine has
    supported source:"deterministic" since T0.1, but nothing emitted it). One
    line per deterministic serve: provider "deterministic" (its own provider
    row in aggregateLlmUsage's provider grouping), zero tokens, zero cost.
    Gated on KP_LLM_USAGE_LOG exactly like emit_result — a direct CLI run
    without the spawnPython sidecar writes nothing. Ledger-only by design:
    LightTrack tracks real provider calls, not template serves.

    ``reason`` names WHY the floor served when the descent happened at the
    availability gate (registry.provider_availability: "offline_policy" /
    "not_installed" / "unavailable", or the caller's "disabled" for --no-llm).
    None when unknown — e.g. an LLM call that failed mid-flight — and unknown
    stays unrecorded rather than guessed."""
    _append_ledger(
        provider="deterministic",
        model=None,
        use_case=use_case,
        input_tokens=0,
        output_tokens=0,
        cached_tokens=None,
        cost_usd=0.0,
        source="deterministic",
        reason=reason,
    )


def emit_result(
    *,
    provider: str,
    model: str | None,
    use_case: str | None,
    usage: dict[str, Any] | None,
    cost_usd: float | None = None,
    duration_ms: int | None = None,
    reason: str | None = None,
) -> None:
    """Record one SUCCESSFUL provider envelope. ``reason`` is normally None — a call
    that answered usably has nothing to explain — and is here for the caller that knows
    the answer was paid for but degraded downstream anyway."""
    u = usage or {}
    cached = u.get("cached_tokens")
    if cached is None:
        cached = u.get("cache_read_input_tokens")
    input_tokens = int(u.get("input_tokens", 0) or 0)
    output_tokens = int(u.get("output_tokens", 0) or 0)
    cached_tokens = int(cached) if cached is not None else None

    # Durable usage ledger — written first, independent of LightTrack below.
    _append_ledger(
        provider=provider,
        model=model,
        use_case=use_case,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_tokens=cached_tokens,
        cost_usd=cost_usd,
        reason=reason,
    )

    client = _client()
    if client is None:
        return
    try:
        client.track(
            _TRACK_PROVIDER.get(provider, provider),
            model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input=cached_tokens,
            operation=_OPERATION,
            latency_ms=duration_ms,
            tags=_tags(provider, use_case),
            metadata={"cost_usd": cost_usd} if cost_usd is not None else None,
            **({"name": use_case} if use_case else {}),
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
    ledger: bool = True,
) -> None:
    """Record one FAILED attempt — to the durable ledger first, then LightTrack.

    The ledger half is the fix for tiger X2. This returned early whenever LightTrack
    was absent (the default deployment), so a call that timed out or 429'd AFTER
    sending a large prompt — the most expensive kind of attempt there is — appeared
    in `llm_usage` nowhere at all, and the spend panel under-reported by exactly the
    traffic an operator most needs to see. The row is written with NULL tokens and
    NULL cost, because the provider reported none: an estimate here would be a guess
    in the column the meters bill against. It carries ``outcome = "failed"``, which
    every money-shaped aggregate excludes — visible, never billable.

    ``ledger=False`` is for the ONE caller whose failure sits on top of an attempt
    already metered as a success: base.complete_json's unparseable-JSON raise happens
    after complete() emitted a real, paid envelope, and a second row there would make
    one logical call look like two events. That descent is recorded where it belongs —
    on the CLI's deterministic line, reason "unparseable_output"."""
    if ledger:
        _append_ledger(
            provider=provider,
            model=model,
            use_case=use_case,
            input_tokens=None,
            output_tokens=None,
            cached_tokens=None,
            cost_usd=None,
            source="llm",
            reason=_failure_reason(error),
            outcome=OUTCOME_FAILED,
        )
    client = _client()
    if client is None:
        return
    try:
        client.track(
            _TRACK_PROVIDER.get(provider, provider),
            model,
            operation=_OPERATION,
            latency_ms=duration_ms,
            error=str(error)[:500],
            tags=_tags(provider, use_case),
            **({"name": use_case} if use_case else {}),
        )
    except Exception:
        pass  # telemetry must never break the host call — the ledger line above is the durable half


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
