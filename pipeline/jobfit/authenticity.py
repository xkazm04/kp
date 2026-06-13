"""Deterministic CV authenticity heuristics (idea-cae71d45).

AI-written and embellished résumés are a top recruiter pain and no incumbent ATS
detects them well. This adds a cheap, deterministic pre-screen over the extracted
CV text and a couple of derived signals (claimed skills count, parsed years) that
flags fabrication / AI-generation risk: heavy generic-buzzword phrasing, a skill
list disproportionate to the CV's detail, an implausible total career span, and a
near-total absence of concrete dates/metrics. The findings are emitted as
``Authenticity: …`` sentences folded into the existing sanity-check trust ledger
(so they count toward review_flags and a recruiter sees them), and the UI derives
a trust band from how many warned.

Pure + deterministic (no LLM, no network) so it's unit-testable and free to run on
every analysis. It is a SCREEN, not a verdict — every finding is phrased "verify…",
human-confirmed. A deeper LLM cross-examination pass is a separate, optional layer.
"""

from __future__ import annotations

import re

# Generic, low-information résumé phrases. A few are expected; a pile of them with
# little concrete detail is the signature of templated / AI-generated padding.
_BUZZWORDS = (
    "results-driven", "results-oriented", "team player", "detail-oriented", "self-starter",
    "go-getter", "synergy", "synergies", "passionate", "proactive", "thought leader",
    "fast-paced", "value-add", "value add", "best practices", "cutting-edge", "track record",
    "hard worker", "hard-working", "go-to person", "move the needle", "hit the ground running",
    "outside the box", "dynamic individual", "highly motivated", "excellent communication skills",
)

# Phrasing for each flag (warn-shaped — the "(manual review)" suffix makes the
# sanity-check classifier treat it as a warning, and the band low/medium).
_BUZZWORD_FLAG = "Authenticity: heavy generic/buzzword phrasing — verify concrete specifics in interview (manual review)."
_SKILL_STUFF_FLAG = "Authenticity: skill list is large relative to the CV's detail — confirm real depth (manual review)."
_IMPLAUSIBLE_YEARS_FLAG = "Authenticity: stated experience exceeds a plausible career span — re-check the dates (manual review)."
_FEW_SPECIFICS_FLAG = "Authenticity: very few concrete dates or metrics — claims are hard to verify (manual review)."
_CLEAN = "Authenticity checks passed — language reads specific and concrete."


def authenticity_checks(raw_text: str, *, skills_count: int = 0, years_experience: int | None = None) -> list[str]:
    """Return the ``Authenticity: …`` findings for a CV. A clean CV returns one
    positive (non-warn) line so the trust band can read 'high'."""
    text = raw_text or ""
    lower = text.lower()
    flags: list[str] = []

    buzz_hits = sum(lower.count(b) for b in _BUZZWORDS)
    if buzz_hits >= 4:
        flags.append(_BUZZWORD_FLAG)

    # A long CV with almost no digits (dates, team sizes, %s, $) reads as vague —
    # a hallmark of generated prose that asserts seniority without specifics.
    if len(text) >= 1500 and sum(ch.isdigit() for ch in text) < 8:
        flags.append(_FEW_SPECIFICS_FLAG)

    # Many skills claimed against a thin document — classic keyword stuffing.
    if skills_count >= 25 and len(text) < 1500:
        flags.append(_SKILL_STUFF_FLAG)

    # No human has > ~45y of professional experience; a larger claim is a date error
    # or fabrication.
    if years_experience is not None and years_experience > 45:
        flags.append(_IMPLAUSIBLE_YEARS_FLAG)

    return flags if flags else [_CLEAN]


# Marker the UI keys on to find these among the other sanity checks.
AUTHENTICITY_PREFIX = "Authenticity"


def authenticity_band(checks: list[str]) -> str:
    """Derive a trust band from the authenticity findings: how many WARNED. 0 → high,
    1 → medium, 2+ → low. Mirrors the warn-marker rule on the TS side; kept here so a
    Python caller can read the band too. (The clean line is not a warn.)"""
    warns = sum(1 for c in checks if c.startswith(AUTHENTICITY_PREFIX) and "manual review" in c)
    if warns == 0:
        return "high"
    return "medium" if warns == 1 else "low"
