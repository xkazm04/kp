"""Structured job-ad model + ingestion (Phase 2 of the v2 matching platform).

A raw job posting (prose) is turned into a structured :class:`Job`: base fields,
requirements split on two axes (``kind``: must/nice, ``hardness``:
prerequisite/learnable), and a precomputed :class:`JobEntryProfile` — the
"graduate lens" that lets student evidence be compared against ads written for
experienced hires.

Two entry points:

- :func:`normalize_job` — *deterministic*. Takes an already-structured dict
  (e.g. an LLM-generated record from the seed corpus) and resolves taxonomy
  terms, anchor salary band, and the entry profile. No LLM, reproducible.
- :func:`ingest_raw_ad` — extracts structure from prose via an LLM provider
  (Gemini or ClaudeCliProvider), then runs :func:`normalize_job`.

The entry profile itself is fully deterministic given structured requirements,
so the frozen seed corpus stays reproducible at rest.
"""

from __future__ import annotations

import re
from typing import Any, Protocol

from pydantic import Field

from .models import _Base
from .taxonomy import (
    DEFAULT_FAMILY,
    ROLE_FAMILY_SET,
    classify_role_family,
    resolve_term,
    role_band,
)

WORK_MODES = ("remote", "hybrid", "onsite")
SENIORITIES = ("junior", "medior", "senior", "lead")
KINDS = ("must_have", "nice_to_have")
HARDNESS = ("prerequisite", "learnable")
EDU_LEVELS = ("phd", "master", "bachelor", "university", "none")

# Surface signals (CZ + EN) that an ad welcomes early-career candidates.
_ENTRY_SIGNALS = (
    "junior",
    "graduate",
    "absolvent",
    "absolvent",
    "intern",
    "internship",
    "stáž",
    "stazista",
    "stážist",
    "praktik",
    "trainee",
    "working student",
    "student",
    "no experience",
    "without experience",
    "bez zkušenost",
    "bez praxe",
    "first job",
    "entry level",
    "entry-level",
    "mentor",
    "training provided",
    "zaškol",
    "nováček",
    "začátečník",
)


class JobRequirement(_Base):
    skill: str
    term_id: str | None = None
    kind: str = "must_have"          # must_have | nice_to_have
    hardness: str = "prerequisite"   # prerequisite | learnable


class JobEntryProfile(_Base):
    is_entry_eligible: bool
    graduate_friendliness: float
    reinterpreted_musts: list[str] = Field(default_factory=list)
    trainable_gaps: list[str] = Field(default_factory=list)
    rationale: str = ""


class Job(_Base):
    id: str
    title: str
    company: str
    location: str
    work_mode: str = "onsite"
    employment_type: str | None = None
    seniority: str = "medior"
    role_family: str = DEFAULT_FAMILY
    languages: list[str] = Field(default_factory=list)
    min_years_experience: float | None = None
    min_education: str | None = None
    description: str = ""
    requirements: list[JobRequirement] = Field(default_factory=list)
    detected_skills: list[str] = Field(default_factory=list)
    salary_band: list[int] = Field(default_factory=list)
    entry_profile: JobEntryProfile | None = None
    source: str = "synthetic"


class LlmProvider(Protocol):
    """Minimal seam satisfied by ClaudeCliProvider and a Gemini adapter."""

    def complete_json(self, prompt: str, *, system: str | None = ...) -> Any: ...


# -- coercion helpers -------------------------------------------------------


def _choice(value: Any, allowed: tuple[str, ...], default: str) -> str:
    if value is None:
        return default
    token = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    return token if token in allowed else default


def _str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def _opt_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _requirements_from(raw: Any) -> list[JobRequirement]:
    out: list[JobRequirement] = []
    if not isinstance(raw, list):
        return out
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, str):
            skill, kind, hardness = item, "must_have", "prerequisite"
        elif isinstance(item, dict):
            skill = _str(item.get("skill") or item.get("name"))
            kind = _choice(item.get("kind"), KINDS, "must_have")
            hardness = _choice(item.get("hardness"), HARDNESS, "prerequisite")
        else:
            continue
        if not skill:
            continue
        key = skill.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            JobRequirement(skill=skill, term_id=resolve_term(skill), kind=kind, hardness=hardness)
        )
    return out


def _reinterpret_must(skill: str) -> str:
    """Translate an experience-oriented must into entry terms a student can meet.

    Strips year/seniority phrasing so "3+ years of React" reads as a foundation
    a graduate can demonstrate through projects rather than tenure.
    """
    cleaned = re.sub(r"\b\d+\+?\s*(?:years?|yrs?|let|roky|roků)\b", "", skill, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(senior|expert|advanced|extensive)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,-")
    return f"Demonstrated foundation in {cleaned or skill}"


def compute_entry_profile(
    *,
    seniority: str,
    employment_type: str | None,
    min_years: float | None,
    requirements: list[JobRequirement],
    description: str,
) -> JobEntryProfile:
    """Deterministic graduate lens over already-structured requirements.

    The constants below (assumed 3.0y for non-junior ads, the +0.5/+0.2/+0.2/+0.1
    additive weights, the years<=1.0 entry threshold, and the 0.15 non-entry
    ceiling) are justified and pinned by golden-value tests; see
    docs/GRADUATE_FRIENDLINESS.md and test_jobs.GraduateFriendlinessGoldenTest.
    This score orders the opportunities a zero-experience student is shown, so
    changing any constant deliberately must update the doc and the golden tests.
    """
    et = (employment_type or "").lower()
    years = min_years if min_years is not None else (0.0 if seniority == "junior" else 3.0)
    text = description.lower()
    entry_signal = any(sig in text for sig in _ENTRY_SIGNALS) or any(
        sig in et for sig in ("intern", "trainee", "working", "student")
    )

    musts = [r for r in requirements if r.kind == "must_have"]
    learnable_musts = [r for r in musts if r.hardness == "learnable"]

    is_entry = seniority == "junior" or years <= 1.0 or entry_signal

    score = 0.0
    if seniority == "junior":
        score += 0.5
    elif seniority == "medior":
        score += 0.2
    if years <= 1.0:
        score += 0.2
    elif years <= 2.0:
        score += 0.1
    if musts:
        score += 0.2 * (len(learnable_musts) / len(musts))
    if entry_signal:
        score += 0.2
    score = round(min(1.0, score), 2)
    if not is_entry:
        # Senior-only postings keep a low ceiling so students aren't lured in.
        score = min(score, 0.15)

    rationale_bits = [f"seniority={seniority}", f"min_years={years:g}"]
    if entry_signal:
        rationale_bits.append("ad uses early-career language")
    if musts:
        rationale_bits.append(f"{len(learnable_musts)}/{len(musts)} must-haves learnable")

    return JobEntryProfile(
        is_entry_eligible=is_entry,
        graduate_friendliness=score,
        reinterpreted_musts=[_reinterpret_must(r.skill) for r in musts],
        trainable_gaps=[r.skill for r in learnable_musts],
        rationale="; ".join(rationale_bits),
    )


def normalize_job(raw: dict[str, Any], *, job_id: str | None = None) -> Job:
    """Deterministically turn a structured (LLM-generated or sourced) record into a Job."""
    title = _str(raw.get("title")) or "Untitled role"
    description = _str(raw.get("description"))
    requirements = _requirements_from(raw.get("requirements"))

    seniority = _choice(raw.get("seniority"), SENIORITIES, "medior")

    role_family = _str(raw.get("role_family")).lower()
    if role_family not in ROLE_FAMILY_SET:
        # Fall back to the taxonomy classifier over the title + requirement skills.
        skill_text = " ".join(r.skill for r in requirements)
        role_family = classify_role_family([r.skill for r in requirements], f"{title} {skill_text} {description}")

    min_years = _opt_float(raw.get("min_years_experience"))
    employment_type = _str(raw.get("employment_type")) or None

    band = role_band(role_family, seniority)
    salary_band = list(band) if band else []

    detected = [r.term_id or r.skill for r in requirements]
    seen: set[str] = set()
    detected_unique = [d for d in detected if not (d in seen or seen.add(d))]

    entry = compute_entry_profile(
        seniority=seniority,
        employment_type=employment_type,
        min_years=min_years,
        requirements=requirements,
        description=description,
    )

    return Job(
        id=job_id or _str(raw.get("id")) or _slug_from_title(title),
        title=title,
        company=_str(raw.get("company")) or "Confidential",
        location=_str(raw.get("location")) or "Praha",
        work_mode=_choice(raw.get("work_mode"), WORK_MODES, "onsite"),
        employment_type=employment_type,
        seniority=seniority,
        role_family=role_family,
        languages=_str_list(raw.get("languages")),
        min_years_experience=min_years,
        min_education=_choice(raw.get("min_education"), EDU_LEVELS, "none") if raw.get("min_education") else None,
        description=description,
        requirements=requirements,
        detected_skills=detected_unique,
        salary_band=salary_band,
        entry_profile=entry,
        source=_str(raw.get("source")) or "synthetic",
    )


def _slug_from_title(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")
    return (base or "job")[:48]


# -- LLM ingestion (prose -> structured) ------------------------------------

_EXTRACTION_SYSTEM = (
    "You are a precise job-ad parser for the Czech tech market. Extract structured "
    "data from postings; never invent requirements that are not present."
)

_EXTRACTION_PROMPT = """Extract this job posting into JSON with exactly these keys:
{
  "title": str, "company": str, "location": str,
  "work_mode": "remote|hybrid|onsite",
  "employment_type": str|null,
  "seniority": "junior|medior|senior|lead",
  "role_family": "software_engineering|data_ai|product_project",
  "languages": [str],
  "min_years_experience": number|null,
  "min_education": "phd|master|bachelor|university|none"|null,
  "description": str,
  "requirements": [ { "skill": str, "kind": "must_have|nice_to_have", "hardness": "prerequisite|learnable" } ]
}
For each requirement decide kind (must vs nice) and hardness: "prerequisite" if a
candidate truly cannot do the job without it, "learnable" if it can reasonably be
picked up on the job. Output JSON only.

POSTING:
"""


def ingest_raw_ad(text: str, *, provider: LlmProvider, job_id: str | None = None) -> Job:
    """Parse a prose job posting into a structured :class:`Job` via an LLM provider."""
    if not text or not text.strip():
        raise ValueError("empty job posting")
    raw = provider.complete_json(_EXTRACTION_PROMPT + text.strip(), system=_EXTRACTION_SYSTEM)
    if not isinstance(raw, dict):
        raise ValueError("LLM did not return a JSON object for the job ad")
    return normalize_job(raw, job_id=job_id)
