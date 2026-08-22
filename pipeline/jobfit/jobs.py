"""Structured job-ad model + ingestion (Phase 2 of the v2 matching platform).

A raw job posting (prose) is turned into a structured :class:`Job`: base fields,
requirements split on two axes (``kind``: must/nice, ``hardness``:
prerequisite/learnable), and a precomputed :class:`JobEntryProfile` — the
"graduate lens" that lets student evidence be compared against ads written for
experienced hires.

Two entry points:

- :func:`normalize_job` — *deterministic*. Takes an already-structured dict
  (e.g. an LLM-generated record from the seed corpus) and resolves taxonomy
  terms, the salary band (stated pay when the record gives one; the anchor band
  otherwise), and the entry profile. No LLM, reproducible.
- :func:`ingest_raw_ad` — extracts structure from prose via an LLM provider
  (Gemini or ClaudeCliProvider), then runs :func:`normalize_job`.

The entry profile itself is fully deterministic given structured requirements,
so the frozen seed corpus stays reproducible at rest.
"""

from __future__ import annotations

import re
from typing import Any, Protocol

from pydantic import Field

from .market_config import ACTIVE_MARKET, gross_period_phrase
from .models import _Base
from .salary_band import normalize_band
from .taxonomy import (
    DEFAULT_FAMILY,
    ROLE_FAMILY_SET,
    classify_role_family,
    resolve_term,
    role_band,
    role_family_catalog,
)

WORK_MODES = ("remote", "hybrid", "onsite")
SENIORITIES = ("junior", "medior", "senior", "lead")
KINDS = ("must_have", "nice_to_have")
HARDNESS = ("prerequisite", "learnable")
# high_school added 2026-08-11: postings demanding a HS diploma had no legal value,
# so extraction was forced into the "none"-vs-diploma self-contradiction the bench flagged.
EDU_LEVELS = ("phd", "master", "bachelor", "university", "high_school", "none")

# -- default policy (single source of truth) --------------------------------
# THE one place the locale/market defaults live. ``normalize_job`` stamps these onto
# a record that OMITS (or supplies an off-taxonomy value for) the field. Each is a
# PHANTOM value the ad never actually stated, so a row that defaulted to
# "Praha"/"medior" must not be read as one that really said it. ``normalize_job``
# records every field it fills from this table in ``Job.defaulted_fields`` so
# matching and any market-stats view can tell stated apart from assumed. The dict
# order is the order ``defaulted_fields`` is reported in; keep these strings here and
# nowhere else.
DEFAULT_POLICY: dict[str, str] = {
    "company": "Confidential",  # ad named no employer (blind / agency posting)
    # No city given — assume the active market's hub (CZ default: "Praha"). Sourced
    # from MarketConfig so re-homing the market moves this locale phantom too.
    "location": ACTIVE_MARKET.default_location,
    "work_mode": "onsite",      # missing/off-taxonomy work mode — assume onsite
    "seniority": "medior",      # missing/off-taxonomy seniority — assume mid-level
}
# A fifth phantom lives OUTSIDE this table because its value is computed, not
# constant: when an ad states no pay (no usable salary_min/salary_max),
# ``normalize_job`` stamps the taxonomy market-anchor band and records
# "salary_band" in ``defaulted_fields`` the same way, so an anchor band is never
# read — or advertised — as pay the ad actually stated.

# Surface signals (CZ + EN) that an ad welcomes early-career candidates.
# Matched as SUBSTRINGS, so every Czech entry must be a STEM that survives
# inflection AND gender: Czech marks gender in the noun itself, and a
# masculine-only surface form silently withholds the signal from an ad written
# in the feminine ("začátečnice", "nováčka"). is_entry_eligible is a HARD
# knockout for early-career candidates in matching.ko_filter, so a missed signal
# rejects every student from a role that welcomes them. Keep stems short enough
# to cover both genders and the oblique cases ("začáteč", not "začátečník").
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
    "nováč",     # nováček / nováčka / nováčkem
    "začáteč",   # začátečník / začátečnice / začátečníky / začáteční
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
    # Provenance: names of the fields normalize_job filled with an assumed value —
    # the DEFAULT_POLICY locale defaults, plus "salary_band" when the taxonomy
    # market-anchor band was stamped because the ad stated no pay. Empty => every
    # field was stated. Lets a phantom "Praha"/"medior"/anchor band be told from a
    # value the ad actually gave, so matching and market-stats never read assumed
    # data as real. See DEFAULT_POLICY.
    defaulted_fields: list[str] = Field(default_factory=list)
    source: str = "synthetic"


class LlmProvider(Protocol):
    """Minimal seam satisfied by ClaudeCliProvider and a Gemini adapter."""

    def complete_json(self, prompt: str, *, system: str | None = ...) -> Any: ...


# -- coercion helpers -------------------------------------------------------


def _choice_defaulted(value: Any, allowed: tuple[str, ...], default: str) -> tuple[str, bool]:
    """Resolve an enum value, also reporting whether the default was substituted.

    ``defaulted`` is True when ``value`` is missing or off-taxonomy — the record never
    stated a valid token, so the returned ``default`` is a phantom that
    :func:`normalize_job` records in ``Job.defaulted_fields``. An explicitly-stated
    value that merely equals the default (e.g. work_mode "onsite") is NOT defaulted.
    """
    if value is None:
        return default, True
    token = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if token in allowed:
        return token, False
    return default, True


def _choice(value: Any, allowed: tuple[str, ...], default: str) -> str:
    return _choice_defaulted(value, allowed, default)[0]


def _str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _str_or_default(value: Any, default: str) -> tuple[str, bool]:
    """Resolve a free-text field, reporting whether the locale default was used.

    The non-enum twin of :func:`_choice_defaulted` (for company/location): a
    missing/blank value yields ``default`` with ``defaulted=True``.
    """
    text = _str(value)
    return (text, False) if text else (default, True)


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
    docs/features/matching/README.md and test_jobs.GraduateFriendlinessGoldenTest.
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

    # Label the assumption: when the posting states no experience figure, `years`
    # is a seniority-derived default — a rationale asserting bare "min_years=3"
    # beside minYearsExperience=null reads as a self-contradiction (2026-08-11
    # bench flagged it on every jd_ingest scenario without a stated figure).
    years_bit = f"min_years={years:g}" + ("" if min_years is not None else " (assumed from seniority)")
    rationale_bits = [f"seniority={seniority}", years_bit]
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
    """Deterministically turn a structured (LLM-generated or sourced) record into a Job.

    Fields the record omits (or fills with an off-taxonomy value) are stamped with the
    locale defaults in :data:`DEFAULT_POLICY`; every field so stamped is listed in
    ``Job.defaulted_fields`` so a phantom "Praha"/"medior" can be told from one the ad
    actually stated. :data:`DEFAULT_POLICY` is the single home of the default values.
    """
    title = _str(raw.get("title")) or "Untitled role"
    description = _str(raw.get("description"))
    requirements = _requirements_from(raw.get("requirements"))

    # Resolve the four DEFAULT_POLICY fields together, recording each phantom default
    # (in policy order) so the provenance set never depends on construction order below.
    defaulted: list[str] = []
    company, used_default = _str_or_default(raw.get("company"), DEFAULT_POLICY["company"])
    if used_default:
        defaulted.append("company")
    location, used_default = _str_or_default(raw.get("location"), DEFAULT_POLICY["location"])
    if used_default:
        defaulted.append("location")
    work_mode, used_default = _choice_defaulted(raw.get("work_mode"), WORK_MODES, DEFAULT_POLICY["work_mode"])
    if used_default:
        defaulted.append("work_mode")
    seniority, used_default = _choice_defaulted(raw.get("seniority"), SENIORITIES, DEFAULT_POLICY["seniority"])
    if used_default:
        defaulted.append("seniority")

    role_family = _str(raw.get("role_family")).lower()
    if role_family not in ROLE_FAMILY_SET:
        # Fall back to the taxonomy classifier over the title + requirement skills.
        skill_text = " ".join(r.skill for r in requirements)
        role_family = classify_role_family([r.skill for r in requirements], f"{title} {skill_text} {description}")

    min_years = _opt_float(raw.get("min_years_experience"))
    employment_type = _str(raw.get("employment_type")) or None

    # Salary: a band the ad actually STATED (salary_min/salary_max) is honored,
    # sanitized through the shared money invariant (swap/round) — never defaulted.
    # Only when no usable stated band exists is the taxonomy market-anchor band
    # stamped, recorded as the "salary_band" phantom so downstream surfaces never
    # advertise the anchor as pay the ad gave.
    salary_min = _opt_float(raw.get("salary_min"))
    salary_max = _opt_float(raw.get("salary_max"))
    stated_band = (
        normalize_band(salary_min, salary_max)
        if salary_min is not None and salary_max is not None
        else None
    )
    if stated_band:
        salary_band = list(stated_band)
    else:
        band = role_band(role_family, seniority)
        salary_band = list(band) if band else []
        if salary_band:
            defaulted.append("salary_band")

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
        company=company,
        location=location,
        work_mode=work_mode,
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
        defaulted_fields=defaulted,
        source=_str(raw.get("source")) or "synthetic",
    )


def _slug_from_title(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")
    return (base or "job")[:48]


# -- LLM ingestion (prose -> structured) ------------------------------------

_EXTRACTION_SYSTEM = (
    "You are a precise job-ad parser. Extract structured data from postings across "
    "any industry, seniority, and region; never invent requirements that are not present."
)


def _role_family_enum() -> str:
    """Pipe-joined role-family ids for the extraction prompt's enum.

    Derived from :func:`taxonomy.role_family_catalog` so the parser is offered
    EVERY known family, not a hardcoded tech-only subset that silently forced a
    nurse/legal/trades ad into ``software_engineering|data_ai|product_project``.
    """
    return "|".join(fam for fam, _desc in role_family_catalog())


def _role_family_reference() -> str:
    """One ``- family: description`` line per known family for the prompt body,
    so the model picks an industry-appropriate family from the full catalog."""
    return "\n".join(f"  - {fam}: {desc}" for fam, desc in role_family_catalog())


def _build_extraction_prompt() -> str:
    return f"""Extract this job posting into JSON with exactly these keys:
{{
  "title": str, "company": str, "location": str,
  "work_mode": "remote|hybrid|onsite",
  "employment_type": str|null,
  "seniority": "junior|medior|senior|lead",
  "role_family": "{_role_family_enum()}",
  "languages": [str],
  "min_years_experience": number|null,
  "min_education": "phd|master|bachelor|university|high_school|none"|null,
  "salary_min": number|null, "salary_max": number|null,
  "description": str,
  "requirements": [ {{ "skill": str, "kind": "must_have|nice_to_have", "hardness": "prerequisite|learnable" }} ]
}}
role_family: pick the single best-fitting family for this role from the catalog
below — choose the industry-appropriate family for any field, not a technology
family by default:
{_role_family_reference()}
salary_min/salary_max: the {gross_period_phrase(ACTIVE_MARKET.period)} pay range the posting itself states, in
whatever currency it uses; null when the ad states no pay — NEVER estimate one.
For each requirement decide kind (must vs nice) and hardness: "prerequisite" if a
candidate truly cannot do the job without it, "learnable" if it can reasonably be
picked up on the job.
Fidelity rules:
- requirements are the QUALIFICATIONS the posting demands of the candidate —
  skills, tools, education, experience, and demanded abilities ("professional
  phone manner", "advanced Excel"), even when the ad states them inside duty
  descriptions. The DUTIES themselves (tasks the person will perform) stay in
  the description. requirements must NOT be empty when the posting demands
  anything of the candidate — every real posting demands something.
- seniority follows the posting's OWN signals (education and experience demanded,
  scope of duties): an ad asking a high-school diploma and some prior experience
  is "junior" — never default to "medior" when the signals point lower.
- Keep the fields consistent with each other: if a requirement or the posting
  names an education level, min_education must state that same level (a posting
  demanding a high-school diploma is min_education "high_school", never "none").
- company/location/work_mode: only what the posting itself states — null when
  absent, never a guess.
Output JSON only.

POSTING:
"""


# Built once from the live taxonomy catalog so a new role family reaches the parser
# without a code edit here.
_EXTRACTION_PROMPT = _build_extraction_prompt()


def ingest_raw_ad(text: str, *, provider: LlmProvider, job_id: str | None = None) -> Job:
    """Parse a prose job posting into a structured :class:`Job` via an LLM provider."""
    if not text or not text.strip():
        raise ValueError("empty job posting")
    raw = provider.complete_json(_EXTRACTION_PROMPT + text.strip(), system=_EXTRACTION_SYSTEM)
    if not isinstance(raw, dict):
        raise ValueError("LLM did not return a JSON object for the job ad")
    return normalize_job(raw, job_id=job_id)
