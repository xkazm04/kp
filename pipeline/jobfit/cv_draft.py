"""Deterministic CV -> profile draft: the keyless twin of the profile_draft prompt.

profile_draft_cli asks a model to read free text into DRAFT_SCHEMA. Without a
provider (no key, KP_OFFLINE, a misconfigured route) that used to be a hard error,
which meant a self-hosted install could not import a CV at all — the one thing the
job-seeker module starts with. This module reads the same text with the pipeline's
own deterministic readers (taxonomy skill terms, language aliases, the years / city
/ seniority regexes the posting structurer already trusts) and returns a payload in
the SAME shape, so ``build_draft`` sanitises and routes it exactly like a model's.

It is honest about what it is: every skill claim carries provenance
``self_declared`` (nothing here proves anything), ``years_experience`` is the first
stated figure or None, and blocks it could not read are simply absent — a thin draft
is a thin draft, never a fabricated one (cv-parsing standard: loss must never
masquerade as absence, so the caller shows ``source: "deterministic"``).
"""

from __future__ import annotations

import re
from typing import Any

from .jobseeker import parse_locations
from .posting_structure import detect_languages, detect_min_years, detect_requirements, detect_seniority
from .taxonomy import classify_role_family

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_URL = re.compile(r"https?://\S+|www\.\S+", re.I)
_EDU = (
    ("phd", re.compile(r"(?<!\w)(ph\.?d|doktor|dr\.|doctorate)(?!\w)", re.I)),
    ("master", re.compile(r"(?<!\w)(master|ing\.|mgr\.|msc|m\.sc|magistr|diplom)(?!\w)", re.I)),
    ("bachelor", re.compile(r"(?<!\w)(bachelor|bc\.|bsc|b\.sc|bakal)\w*", re.I)),
    ("university", re.compile(r"\b(universit|vysok[áa] [šs]kola|v[šs]e|[čc]vut|fakult|faculty|hochschule|universidad|université)\w*", re.I)),
)
_SENIOR_TO_LEVEL = {"junior": "working", "medior": "working", "senior": "strong", "lead": "strong"}
_ASPIRATION = re.compile(
    r"(?:looking for|seeking|hled[áa]m|chci|target|open to|suche|cherche)\s+(?:an?\s+|the\s+)?([^.\n,;]{4,60})",
    re.I,
)
_STUDENT = re.compile(r"\b(student|studuj|studying|enrolled|expected graduation|absolvuji|absolvent 20\d\d)\b", re.I)


def _display_name(text: str) -> str | None:
    """The first short line that is not contact data and has no digits — the name in
    every CV genre we have seen; None when the first lines look like a heading."""
    for line in text.splitlines()[:6]:
        s = line.strip(" -•|\t")
        if not s or len(s) > 60 or _EMAIL.search(s) or _URL.search(s) or _PHONE.search(s):
            continue
        if any(ch.isdigit() for ch in s):
            continue
        words = s.split()
        if 1 < len(words) <= 5 and all(w[:1].isalpha() for w in words):
            return s
    return None


def _first_sentences(text: str, n: int = 2) -> str:
    parts = re.split(r"(?<=[.!?])\s+", " ".join(text.split()))
    return " ".join(p for p in parts[:n] if p).strip()[:240]


def deterministic_draft(text: str, lang: str = "en") -> dict[str, Any]:
    """A DRAFT_SCHEMA payload read from ``text`` with no model. Pure."""
    body = text or ""
    skills = [r["skill"] for r in detect_requirements(body)]
    seniority = detect_seniority(_first_sentences(body, 3)) or detect_seniority(body[:400])
    level = _SENIOR_TO_LEVEL.get(seniority or "", "working")
    years = detect_min_years(body)
    languages = detect_languages(body)
    name = _display_name(body)
    # Places are read from the header lines only (a CV names its city up top; the body
    # names every city the person ever worked in), never from the name line itself,
    # and a "place" longer than three words is a sentence fragment, not a city.
    header_lines = [ln for ln in body.splitlines()[:6] if ln.strip() and (not name or name not in ln or " - " in ln or "," in ln)]
    header = chr(10).join(header_lines)
    places = parse_locations(header.replace(name, " ") if name else header)
    candidates = [
        p
        for p in places["locations"]
        if 0 < len(p.split()) <= 3 and p != name and p[:1].isupper() and not _EMAIL.search(p) and not _PHONE.search(p)
    ]
    location = candidates[0] if candidates else None
    education = "unknown"
    detail = ""
    for label, pattern in _EDU:
        m = pattern.search(body)
        if m:
            education = label
            line = next((ln.strip() for ln in body.splitlines() if pattern.search(ln)), "")
            detail = line[:120]
            break
    aspirations = []
    for m in _ASPIRATION.finditer(body):
        a = m.group(1).strip()
        if a and a.lower() not in {x.lower() for x in aspirations}:
            aspirations.append(a)
        if len(aspirations) >= 3:
            break
    summary = _first_sentences(body)
    experiences: list[dict[str, Any]] = []
    if summary:
        experiences.append({"kind": "job", "title": "Summary", "text": summary, "skills": skills[:6], "link": None})
    enrolled = bool(_STUDENT.search(body))
    return {
        "display_name": name,
        "role_family": classify_role_family(skills, body),
        "education_level": education,
        "education_detail": detail,
        "languages": languages,
        "location": location,
        "availability": None,
        "years_experience": years,
        "aspirations": aspirations,
        "skill_claims": [{"skill": s, "level": level, "provenance": "self_declared"} for s in skills],
        "experiences": experiences,
        "is_enrolled": enrolled,
        "expected_graduation": None,
        "wants_domain_change": False,
        "has_substantial_experience": bool(years and years >= 2) or seniority in ("senior", "lead"),
    }
