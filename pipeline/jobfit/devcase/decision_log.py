"""Parse the candidate's DECISIONS.md by the STRUCTURE of the seeded template.

The seeded log (``seed_materializer._decisions_template``) is one ``## Task N: …``
section per task, each holding three bullets in a fixed order — decision, rejected
alternative, why. Parsing keys on that structure (headings, bullet position, the first
colon), never on English words, so a log written in Czech, German or French parses the
same as an English one. A fourth bullet is read as the counterfactual ("what would make
you choose differently"); a free-form bullet outside any section is a decision on its own.

Entries are EVIDENCE FOR THE DEBRIEF ONLY: ``mint_followups`` quotes them so an
interviewer can ask each candidate about their own rationale. Nothing here feeds a score,
judgment, band or confidence — never grade the log's length, count or presence (writing
one is ordinary practice, and an untouched template is simply "no logged decision").

The log is candidate-authored and adversarial: whoever puts these entries in a prompt
fences them (``provenance.fenced_untrusted``).
"""
from __future__ import annotations

import re

from .seed_materializer import DECISIONS_FILE

# Entries and field lengths are bounded so a hostile log cannot bloat a prompt.
MAX_ENTRIES = 8
MAX_FIELD_CHARS = 400

_FIELDS = ("decision", "rejected", "why", "counterfactual")
_HEADING_RE = re.compile(r"^\s{0,3}#{2,6}\s+(.*)$")
_BULLET_RE = re.compile(r"^\s{0,3}[-*+]\s+(.*)$")


def _clip(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:MAX_FIELD_CHARS]


def _value(bullet: str) -> str:
    """The text after the label's first colon (labels are the template's words in
    whatever language the log is written in). A bullet with no colon is all value."""
    head, sep, tail = bullet.partition(":")
    return _clip(tail if sep and len(head) <= 60 else bullet)


def _section_entry(heading: str, bullets: list[str]) -> dict | None:
    values = [_value(b) for b in bullets]
    entry = {"task": _clip(heading)}
    for i, name in enumerate(_FIELDS):
        entry[name] = values[i] if i < len(values) else ""
    if len(values) > len(_FIELDS):
        entry["counterfactual"] = _clip(" ".join(values[len(_FIELDS) - 1:]))
    # An untouched template section: every field still blank.
    return entry if any(entry[n] for n in _FIELDS) else None


def parse_decision_log(text: str | None) -> list[dict]:
    """``[{task, decision, rejected, why, counterfactual}]`` — blank template sections are dropped."""
    headed: list[tuple[str, list[str]]] = []
    free: list[str] = []
    current: tuple[str, list[str]] | None = None
    for raw in (text or "").splitlines():
        h = _HEADING_RE.match(raw)
        if h:
            current = (h.group(1), [])
            headed.append(current)
            continue
        b = _BULLET_RE.match(raw)
        if b:
            (current[1] if current else free).append(b.group(1))
        elif raw.strip() and (current[1] if current else free):
            # a wrapped continuation of the previous bullet
            bucket = current[1] if current else free
            if raw.startswith((" ", "\t")):
                bucket[-1] = f"{bucket[-1]} {raw.strip()}"
    entries: list[dict] = []
    for bullet in free:
        v = _value(bullet)
        if v:
            entries.append({"task": "", "decision": v, "rejected": "", "why": "", "counterfactual": ""})
    for heading, bullets in headed:
        e = _section_entry(heading, bullets)
        if e:
            entries.append(e)
    return entries[:MAX_ENTRIES]


def decision_log_entries(files: list[dict] | None) -> list[dict] | None:
    """Entries from the submitted tree's decision log; ``None`` when no tree was submitted
    (repo-link submissions) so the caller leaves the follow-ups exactly as they were."""
    if not files:
        return None
    wanted = DECISIONS_FILE.casefold()
    for f in files:
        if isinstance(f, dict) and str(f.get("path") or "").replace("\\", "/").rsplit("/", 1)[-1].casefold() == wanted:
            return parse_decision_log(str(f.get("contents") or ""))
    return []
