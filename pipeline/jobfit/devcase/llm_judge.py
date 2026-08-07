"""Shared LLM-as-judge plumbing for the Dev pipeline evals.

``submission_eval.judge``, ``lifecycle_audits.judge`` and
``lifecycle_audits.audit_role_fit`` each reimplemented the same fragile scaffold:
build a list of prompts, ``provider.map`` them, zip the results back to the items,
swallow ``ClaudeCliError``, parse ``res.json()`` inside a bare try/except, and skip
malformed payloads. That core now lives here once, so hardening the error handling
or the parse guard happens in a single place instead of in triplicate.

Callers supply only their two custom pieces:
  - ``prompt_fn(item) -> str``        — the prompt for one item
  - ``parse_fn(item, payload: dict)`` — shape the result (mutate the item, or record
                                        into a closure). Called ONLY for a successful,
                                        dict-shaped JSON payload.

An item whose call errors (``ClaudeCliError``), whose body fails to parse, or whose
payload is not a dict is silently skipped — ``parse_fn`` is never invoked for it, so
callers can treat "parse_fn ran" as "we have a valid judgment".

JUDGE ≠ GENERATOR (the invariant this module now owns)
------------------------------------------------------
These judges are FAIRNESS AND QUALITY GATES over artifacts another model produced.
Every caller used to hand ``run_judge`` the very provider that generated those
artifacts (a bare ``ClaudeCliProvider()``), so the gate was self-grading: the same
engine, the same blind spots, marking its own homework. :func:`resolve_judge_provider`
routes the judge through ``resolve_provider("devcase_judge")`` instead, so
``KP_LLM_CONFIG`` can pin a *different* model for the judge seat (and the judge's spend
lands in the usage ledger, which a bare provider bypassed).

Routing alone does not make the judge independent — with no config both seats fall back
to the same CLI default. :func:`judge_independence` measures it, so a run can *report*
whether its gate was independent and ``--strict`` can refuse to certify one that was not.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

from ..claude_cli import ClaudeCliError, ClaudeCliProvider

# Timeout for the judge seat. Judges read a truncated artifact dump and answer with a
# small JSON verdict, so they are cheaper than the generation calls they grade.
JUDGE_TIMEOUT_S = 150


def resolve_judge_provider(*, timeout: int = JUDGE_TIMEOUT_S) -> Any:
    """The provider for the JUDGE seat, routed through the ``devcase_judge`` use case.

    Imported lazily: ``..llm`` pulls in the adapter registry + config loader, and the
    eval harnesses must stay importable (for ``--no-llm`` runs and unit tests) without
    that chain. Returns a ClaudeCliProvider-compatible object, so ``run_judge`` is
    unchanged; with no ``KP_LLM_CONFIG`` it is a MonitoredClaudeCli on the CLI default —
    same behavior as the bare provider it replaces, but metered.
    """
    from ..llm import resolve_provider

    return resolve_provider("devcase_judge", timeout=timeout)


def provider_identity(provider: Any | None) -> str:
    """``provider/model`` label for a provider, for reporting and the independence check.

    Adapters carry ``name`` (a class attribute) + ``model``; ClaudeCliProvider carries
    only ``model`` and may leave it None (meaning "the CLI's configured default"). A
    None model is reported as ``default`` rather than guessed — two seats both on the
    CLI default are the same engine, which is precisely what must not certify a gate.
    """
    if provider is None:
        return "none"
    name = getattr(provider, "name", None) or "claude_cli"
    return f"{name}/{getattr(provider, 'model', None) or 'default'}"


def judge_independence(generator: Any | None, judge: Any | None) -> dict:
    """Is the judge seat a different engine from the one that produced the artifacts?

    Returns ``{generator, judge, independent}``. ``independent`` is False when both
    seats resolve to the same provider/model — the self-grading case — and when either
    seat is absent (nothing was judged independently, so nothing may claim it was).
    Callers surface this in their report; ``--strict`` treats a judged-but-not-
    independent run as an uncertified gate.
    """
    gen_id, judge_id = provider_identity(generator), provider_identity(judge)
    return {
        "generator": gen_id,
        "judge": judge_id,
        "independent": bool(generator is not None and judge is not None and gen_id != judge_id),
    }


def run_judge(
    items: Sequence[Any],
    prompt_fn: Callable[[Any], str],
    parse_fn: Callable[[Any, dict], None],
    provider: ClaudeCliProvider,
    workers: int = 4,
) -> None:
    """Run ``prompt_fn`` over ``items`` through the LLM judge, shaping each valid
    result with ``parse_fn``. Errors / unparseable / non-dict payloads are skipped."""
    prompts = [prompt_fn(item) for item in items]
    results = provider.map(prompts, max_workers=workers)
    for item, res in zip(items, results):
        if isinstance(res, ClaudeCliError):
            continue
        try:
            payload = res.json()
        except Exception:
            continue
        if isinstance(payload, dict):
            # The contract is "malformed payloads are silently skipped" — but the
            # guard above only covered res.json(), NOT parse_fn. A dict of the wrong
            # SHAPE (e.g. {"score": null} or {"score": "good"}) makes a caller's
            # parse_fn raise — int(None)/int("good") — and, since this loop is
            # synchronous, that exception aborted the ENTIRE judge pass: every
            # not-yet-shaped row lost its verdict and the eval crashed. Guard the
            # shape step too, so one off-spec payload skips just its own row and the
            # rest are still judged.
            try:
                parse_fn(item, payload)
            except Exception:
                continue
