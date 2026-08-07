"""Deterministic credential / licence gate.

For regulated roles (RN, FINRA Series 7/63, OSHA, PE, CPA, bar admission, CDL, board
certification, …) a MISSING or EXPIRED licence is a hard, legally-consequential
blocker. The CV schema already captures structured ``credentials`` (name + expiry),
but evaluating them was delegated 100% to the LLM's free-text recruiter_risk_flags —
a single missed generation = a silent wrong hiring outcome with compliance exposure.

This adds a cheap, deterministic safety net (mirroring ``authenticity_checks``):

  * required-but-missing — the JD names a regulated licence the candidate's
    credentials do not include;
  * expiry — a *regulated* credential carries a date that has already passed.

Findings are emitted as ``Credential: …(manual review)`` sentences folded into the
existing sanity-check trust ledger, independent of whether the LLM flagged them.

The expiry check is deliberately scoped to regulated licences only: the schema's
``expiry`` field may hold an ISSUE date rather than an expiry, so flagging every
past date would be noise — bounding it to genuine hard-gate licences keeps the
false-positive cost to a recruiter's glance. Pure + deterministic (no LLM, no
network), unit-testable. A SCREEN, not a verdict — every finding says "verify".
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

CREDENTIAL_PREFIX = "Credential"

# Regulated hard-gate licences. Each spec: (JD cue, human label, candidate-name cues
# that count as "held"). Conservative — only licences that are genuine blockers.
_LICENCE_SPECS: tuple[tuple[re.Pattern[str], str, tuple[re.Pattern[str], ...]], ...] = tuple(
    (re.compile(jd, re.IGNORECASE), label, tuple(re.compile(p, re.IGNORECASE) for p in name_pats))
    for jd, label, name_pats in (
        (r"\bregistered nurse\b|\bRN licen[sc]e\b", "Registered Nurse (RN) license", (r"\bRN\b", r"registered nurse")),
        (r"\bseries[\s-]?7\b", "FINRA Series 7", (r"series[\s-]?7",)),
        (r"\bseries[\s-]?63\b", "FINRA Series 63", (r"series[\s-]?63",)),
        (r"\bOSHA\b", "OSHA card", (r"\bOSHA\b",)),
        (r"\bprofessional engineer\b|\bPE licen[sc]e\b", "Professional Engineer (PE) license", (r"\bP\.?E\.?\b", r"professional engineer")),
        (r"\bCPA\b|certified public accountant", "CPA license", (r"\bCPA\b", r"certified public accountant")),
        (r"\bbar admission\b|admitted to the bar|member of the bar", "Bar admission", (r"bar admission", r"member of the bar", r"admitted to the bar")),
        (r"\bCDL\b|commercial driver'?s licen[sc]e", "Commercial Driver's License (CDL)", (r"\bCDL\b", r"commercial driver")),
        (r"\bboard[- ]?certif", "Board certification", (r"board[- ]?certif",)),
    )
)

_YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")


def _month_for_year(expiry: str, year: int) -> int | None:
    """The month (1-12) directly adjacent to ``year`` — ``YYYY-MM`` / ``YYYY/MM`` or
    ``MM-YYYY`` / ``MM/YYYY`` — or None. Deliberately NOT "any 1-12 number in the
    string": a stray day or an id (e.g. ``'cert #3'``) must not be read as a month.
    bug-ui-scan-2026-07-09 (llm-provider-layer-python #5)."""
    ys = re.escape(str(year))
    m = re.search(rf"\b{ys}[-/](0?[1-9]|1[0-2])\b", expiry)  # YYYY-MM
    if m:
        return int(m.group(1))
    m = re.search(rf"\b(0?[1-9]|1[0-2])[-/]{ys}\b", expiry)  # MM-YYYY
    if m:
        return int(m.group(1))
    return None


def _parse_past(expiry: str, today: date) -> bool:
    """True only when the date string clearly parses to a point strictly before today.
    Conservative: an unparseable / yearless string returns False (the LLM gate still
    covers the narrative)."""
    if not expiry:
        return False
    years = [int(y) for y in _YEAR_RE.findall(expiry)]
    if not years:
        return False
    # Two years in one string (e.g. "Issued 2020, expires 2028") → the LATER one is
    # the expiry. Take the max, not re.search's FIRST match, which read the issue
    # year and false-flagged a still-current licence as expired.
    # bug-ui-scan-2026-07-09 (llm-provider-layer-python #5).
    year = max(years)
    if year < today.year:
        return True
    if year > today.year:
        return False
    # Same year — only past when a month tied to THAT year clearly precedes this
    # month. Using a month adjacent to the year (not any stray number elsewhere)
    # avoids a false past-flag from a day / id; no adjacent month → conservative
    # don't-flag, honoring the module's "false positives to a glance" promise.
    mm = _month_for_year(expiry, year)
    return mm is not None and mm < today.month


def _name(cred: Any) -> str:
    return str((cred.get("name") if isinstance(cred, dict) else getattr(cred, "name", "")) or "")


def _expiry(cred: Any) -> str:
    return str((cred.get("expiry") if isinstance(cred, dict) else getattr(cred, "expiry", "")) or "")


def credential_checks(
    job_description_text: str | None,
    credentials: list[Any] | None,
    *,
    today: date | None = None,
) -> list[str]:
    """Return ``Credential: …(manual review)`` findings. Empty when nothing to flag
    (credentials are not always relevant, so there is no positive 'clean' line)."""
    today = today or date.today()
    creds = credentials or []
    held_names = [_name(c) for c in creds if _name(c)]
    flags: list[str] = []

    jd = job_description_text or ""
    for jd_re, label, name_res in _LICENCE_SPECS:
        # Required-but-missing: JD demands this licence and no held credential names it.
        if jd and jd_re.search(jd):
            if not any(any(nr.search(n) for nr in name_res) for n in held_names):
                flags.append(
                    f"Credential: the role appears to require a {label}, not found in the "
                    f"candidate's credentials — verify before advancing (manual review)."
                )
        # Expiry: a held regulated credential carries a date already in the past.
        for c in creds:
            nm = _name(c)
            if nm and any(nr.search(nm) for nr in name_res) and _parse_past(_expiry(c), today):
                flags.append(
                    f"Credential: '{nm}' carries a date ({_expiry(c).strip()}) that appears to "
                    f"be in the past — confirm the licence is current (manual review)."
                )

    # De-duplicate while preserving order (a licence can match two name cues).
    seen: set[str] = set()
    out: list[str] = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out
