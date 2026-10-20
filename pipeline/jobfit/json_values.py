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
    is given, the answer is pinned BY SHAPE: among the dicts carrying at least one
    of those keys, the one covering the MOST of them wins, and the last one wins a
    tie. So a trailing object carrying a subset of the keys (the shape a prompt
    injection in candidate-authored input takes: ``{"summary": "Outstanding"}``
    after a genuine evaluation) cannot displace a fuller answer, while an echoed
    example with the same keys still loses to the real answer after it.

    The one behaviour this ranking changes (challenge-r08 tests-devcase/A): an
    EARLIER parseable object covering strictly more expected keys than a genuine
    last answer that legitimately omits an optional key now wins. Example schemas
    written as pseudo-JSON do not parse, so the common few-shot echo cannot trigger
    it. Still open: a tail copying the FULL shape ties and wins, and single-key pins
    cannot rank at all — the fencing of untrusted input is their defence.

    ``candidates`` must be non-empty; callers raise their own "nothing parsed".
    """
    if expected_keys:
        wanted = set(expected_keys)
        best: Any = None
        best_cover = 0
        for value in candidates:
            if not isinstance(value, dict):
                continue
            cover = len(wanted.intersection(value))
            if cover and cover >= best_cover:  # ``>=``: the last one wins a tie
                best, best_cover = value, cover
        if best_cover:
            return best
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
