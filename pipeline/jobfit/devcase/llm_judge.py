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
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

from ..claude_cli import ClaudeCliError, ClaudeCliProvider


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
            parse_fn(item, payload)
