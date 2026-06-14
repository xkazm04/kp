"""Shared provenance helper for the Dev pipeline.

ONE definition of "how degraded was this multi-step run": collapse the per-step
``"llm"``/``"deterministic"`` sources into a single tri-state verdict. The CLI
provenance envelope (:mod:`devcase_cli`) and BOTH eval harnesses
(:mod:`submission_eval`, :mod:`lifecycle_eval`) call this one helper, so ``"partial"``
means the same thing everywhere and the reports can never drift back to the misleading
binary "llm-if-any" collapse (which reported a fully-LLM run whenever a single step
used the LLM, overstating coverage and hiding the deterministic fallbacks).

This module also owns the *other* half of the fallback contract: WHY a step fell
back. :func:`generate_with_fallback` is the single LLM-or-deterministic runner shared
by every ``_generate`` in analyze/design/evaluate/reflect — it captures the swallowed
exception (type + message), logs it at WARNING, and stashes a one-line reason on the
artifact so :mod:`devcase_cli` can surface it beside ``perStepSources``. Without it a
fully-deterministic run looks identical whether the provider was down, slow, or
returning garbage; with it an operator/UI can tell those apart.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

# The three provenance states a (multi-)step run can collapse to.
SOURCE_LLM = "llm"
SOURCE_PARTIAL = "partial"
SOURCE_DETERMINISTIC = "deterministic"

# Key under which :func:`generate_with_fallback` stashes the fallback reason INSIDE the
# returned artifact. ``devcase_cli`` pops it off the artifact into the envelope's
# ``fallbackReason`` map, so the reason rides beside ``perStepSources`` rather than
# polluting the artifact (and its model round-trip). Present ONLY when the LLM path
# actually raised — a ``provider is None`` / clean-LLM run never carries it.
FALLBACK_REASON_KEY = "fallbackReason"

# Cap the captured message so a verbose provider error body (e.g. an echoed prompt or a
# 300-char unparsed-JSON snippet) can't bloat the envelope or a log line.
_MAX_REASON_CHARS = 300


def str_list(value: Any) -> list[str]:
    """Coerce arbitrary model output into a clean ``list[str]``.

    Drops non-list input and any blank entries, stringifying + stripping the rest.
    Shared by every devcase artifact ``coerce()`` (analyze/design/evaluate/reflect)
    so the four steps clean LLM lists identically and can't drift.
    """
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()]


def combine_source(*srcs: str) -> str:
    """Collapse per-step sources into one tri-state verdict.

    The old ``"llm" if "llm" in srcs else "deterministic"`` reported a fully-LLM run
    whenever a *single* step used the LLM, hiding that the rest fell back to deterministic
    templates. We return a tri-state instead — ``"partial"`` for a mix — so a degraded run
    reads honestly: a fully-LLM run is ``"llm"``, an all-deterministic (or empty) run is
    ``"deterministic"``, and anything mixed is ``"partial"``. Empty/falsy sources are ignored.
    """
    uniq = {s for s in srcs if s}
    if uniq == {SOURCE_LLM}:
        return SOURCE_LLM
    if uniq <= {SOURCE_DETERMINISTIC}:  # all deterministic (or empty)
        return SOURCE_DETERMINISTIC
    return SOURCE_PARTIAL


def describe_fallback(exc: BaseException) -> str:
    """One-line ``"<ExceptionType>: <message>"`` for a swallowed LLM exception.

    This is what lets an operator/UI tell a timeout from a JSON parse error from a
    misconfigured provider apart — the exception TYPE and message differ for each
    (e.g. :class:`~pipeline.jobfit.claude_cli.ClaudeCliProvider` raises ``ClaudeCliError``
    whose message is "timed out after …", "did not return parseable JSON: …", or "not
    found … Is it installed and on PATH?"). Truncated so a verbose body can't bloat the
    envelope; falls back to the bare type name when the exception has no message.
    """
    name = type(exc).__name__
    msg = str(exc).strip()
    text = f"{name}: {msg}" if msg else name
    return text[:_MAX_REASON_CHARS]


def generate_with_fallback(
    provider: Any | None,
    prompt: str,
    system: str,
    deterministic: Callable[[], dict],
    coerce: Callable[[Any], dict],
    logger: logging.Logger,
) -> tuple[dict, str]:
    """Run an LLM JSON completion with a deterministic fallback, RECORDING why it fell back.

    The single LLM-or-deterministic contract shared by every ``_generate`` in
    analyze/design/evaluate/reflect (they differ only in their ``system`` preamble and
    their ``deterministic``/``coerce`` closures), so the "capture the cause, log it,
    surface it" behaviour can never drift across the four steps. Three outcomes:

    * ``provider is None`` — the LLM is off by design (``--no-llm`` or the provider was
      unavailable): a clean deterministic run, NO reason recorded. The ``"deterministic"``
      source already says the template was used; this is not a failure.
    * the LLM call succeeds — ``coerce`` the payload, source ``"llm"``.
    * the LLM call RAISES — the cause used to be swallowed by a bare ``except Exception``,
      making a slow, a down and a garbage-returning provider indistinguishable in a
      fully-deterministic run. We now log it at WARNING (attributed to the calling
      module's ``logger`` so operators see WHICH step degraded) and stash a one-line
      :func:`describe_fallback` reason on the returned artifact under
      :data:`FALLBACK_REASON_KEY`, which ``devcase_cli`` lifts into the provenance envelope.

    Returns the usual ``(artifact, source)`` tuple — the reason rides inside ``artifact``
    so the four ``_generate`` signatures (and every call site) stay unchanged.
    """
    if provider is None:
        return deterministic(), SOURCE_DETERMINISTIC
    try:
        payload = provider.complete_json(prompt, system=system)
        return coerce(payload), SOURCE_LLM
    except Exception as exc:
        reason = describe_fallback(exc)
        logger.warning("LLM step fell back to deterministic: %s", reason)
        result = deterministic()
        result[FALLBACK_REASON_KEY] = reason
        return result, SOURCE_DETERMINISTIC
