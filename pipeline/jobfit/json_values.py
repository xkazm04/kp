"""The JSON-value scanner every LLM adapter reads model output through.

An LLM answer is prose with JSON somewhere inside it, and every adapter has to
find that JSON. The scan was written twice — near-verbatim in ``claude_cli.py``
and ``gemini.py`` — and ``llm/base.py`` imported the *CLI's private copy* to get
at it, so a fix to one scanner silently left the other behind. It lives here
once now, with the two SELECTION policies that sit on top of it kept as
separately named, separately tested functions, because they are genuinely
different decisions and collapsing them would change behaviour:

* :func:`select_last_matching` — the Claude-CLI policy. The last top-level value
  wins (few-shot prompts make the model echo the example schema before the real
  answer), narrowed to the last value carrying one of ``expected_keys``.
* :func:`select_best_scoring` — the Gemini grounded policy. A grounded answer
  embeds citation blobs and stray objects around the payload, so candidates are
  RANKED by how many schema keys they carry, then by size, with document order
  as the final tiebreak only.

Nothing here raises a provider-specific error: callers own their error type
(``ClaudeCliError``/``ValueError`` vs ``GeminiError``) and this module answers
with values or an empty list.
"""

from __future__ import annotations

import json
import re
from typing import Any, Sequence

# A fenced block is the model's deliberate answer envelope; prefer it when any
# of its content parses. Non-greedy, DOTALL, optional ``json`` info string.
_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def scan_json_values(text: str) -> list[Any]:
    """Every top-level JSON value embedded in ``text``, in order of appearance.

    Walks the string, and at each ``{``/``[`` attempts ``raw_decode``; on success
    it records the value and skips past it, on failure it advances one char. A
    nested ``{`` inside a decoded value is consumed as part of that value, so the
    list holds only *top-level* values (an array of objects is one entry).
    """
    decoder = json.JSONDecoder()
    values: list[Any] = []
    idx, n = 0, len(text)
    while idx < n:
        if text[idx] in "{[":
            try:
                value, end = decoder.raw_decode(text, idx)
                values.append(value)
                idx = end
                continue
            except json.JSONDecodeError:
                pass
        idx += 1
    return values


def candidate_values(text: str) -> list[Any]:
    """Scan for candidates the way every adapter does: fenced blocks first.

    Values found inside ```` ```json ```` fences win outright — the model put the
    answer in an envelope on purpose. Only when no fence yields a parseable value
    is the whole text scanned.
    """
    candidates: list[Any] = []
    for block in _FENCE_RE.findall(text):
        candidates.extend(scan_json_values(block.strip()))
    if not candidates:
        candidates = scan_json_values(text)
    return candidates


def select_last_matching(
    candidates: Sequence[Any], expected_keys: Sequence[str] | None = None
) -> Any:
    """The Claude-CLI selection policy: the LAST value, keyed if we know the shape.

    Returning the last value — not the first — is deliberate: few-shot prompts
    often make the model echo the example schema object before the real answer,
    and a first-value policy silently returned that echo. When ``expected_keys``
    is given, the last value carrying any of those keys wins, which pins the
    answer even if it is not the trailing value.

    ``candidates`` must be non-empty; callers raise their own "nothing parsed".
    """
    if expected_keys:
        keyed = [
            v for v in candidates if isinstance(v, dict) and any(k in v for k in expected_keys)
        ]
        if keyed:
            return keyed[-1]
    return candidates[-1]


def select_best_scoring(
    dicts: Sequence[dict[str, Any]], expected_keys: Sequence[str] = ()
) -> dict[str, Any]:
    """The Gemini grounded selection policy: rank, don't just take the last.

    A grounded response may embed multiple JSON objects in its prose — the real
    payload plus citation blobs, a stray ``{"note": ...}``, or an echoed example.
    Blindly taking the last one let a single chatty trailing sentence swap the
    payload for garbage. Rank candidates by how many of the schema's top-level
    keys they carry, then by size, and only use document order (later wins) as
    the final tiebreak — so the real payload still beats an empty leading brace.

    ``dicts`` must be non-empty; callers raise their own "nothing parsed".
    """
    wanted = set(expected_keys)

    def rank(item: tuple[int, dict[str, Any]]) -> tuple[int, int, int]:
        idx, candidate = item
        matched = len(wanted & candidate.keys()) if wanted else 0
        return (matched, len(candidate), idx)

    return max(enumerate(dicts), key=rank)[1]


def extract_json(text: str, *, expected_keys: Sequence[str] | None = None) -> Any:
    """Best-effort JSON extraction from an LLM text answer (the CLI policy).

    Returns the value chosen by :func:`select_last_matching` over
    :func:`candidate_values`. Raises ``ValueError`` if nothing parses — the
    caller maps that onto its own error vocabulary.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")

    candidates = candidate_values(text)
    if not candidates:
        raise ValueError("no JSON value found")
    return select_last_matching(candidates, expected_keys)
