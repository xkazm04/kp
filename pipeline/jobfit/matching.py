"""Candidate -> many-jobs matching engine (Phase 3 of the v2 platform).

Three layers of increasing cost (diagram 06):

  A. KO filter   — cheap, hard gates (seniority floor, education, languages,
                   work-mode preference). Logically a DB query; over the demo
                   corpus (~150) it runs in memory.
  B. Multi-factor scorer — skills (taxonomy hierarchy + provenance-weighted),
                   career fit, personal fit -> weighted total + confidence band.
  C. LLM reasoning — added in Phase 3b on the top-N (cached per candidate x job).

The scorer is archetype-aware via :func:`weights_for`; BAU is wired now,
``early_career`` / ``career_switcher`` profiles plug in for Phases 5/7.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import Field

from .jobs import Job
from .models import _Base
from .taxonomy import DEFAULT_PROVENANCE, skill_match_score

_SENIORITY_RANK = {"junior": 1, "medior": 2, "senior": 3, "lead": 4}
_EDU_RANK = {"none": 0, "university": 1, "bachelor": 2, "master": 3, "phd": 4}

# Language alias buckets so "Czech (native)" satisfies a "Czech" requirement.
_LANG_ALIASES = {
    "english": ("english", "angli", "en "),
    "czech": ("czech", "česk", "cesk", "čeština", "cestina"),
    "german": ("german", "deutsch", "němč", "nemc"),
    "slovak": ("slovak", "slovenš", "slovens"),
}

# Archetype scoring weights (must sum to 1.0). For non-BAU profiles the "career"
# slot carries the POTENTIAL score (readiness) instead of work-history fit, and
# "personal" carries motivation/domain fit — see score_job.
WEIGHTS: dict[str, dict[str, float]] = {
    "bau": {"skills": 0.50, "career": 0.35, "personal": 0.15},
    "student": {"skills": 0.40, "career": 0.40, "personal": 0.20},
    "career_switcher": {"skills": 0.35, "career": 0.40, "personal": 0.25},
}
_EARLY_CAREER = ("student", "career_switcher")
_MATCH_THRESHOLD = 0.5  # per-requirement score at/above which a skill counts as matched


class MatchCandidate(_Base):
    skills: list[str] = Field(default_factory=list)
    seniority: str = "medior"
    role_family: str = "software_engineering"
    education_level: str = "unknown"
    languages: list[str] = Field(default_factory=list)
    years_experience: float = 0.0
    traits: list[str] = Field(default_factory=list)
    summary: str = ""
    archetype: str = "bau"
    provenance_default: str = DEFAULT_PROVENANCE
    # per-skill provenance (display skill -> provenance); falls back to provenance_default.
    skill_provenance: dict[str, str] = Field(default_factory=dict)
    # readiness model output (replaces years/seniority for early-career); set by the transform.
    potential_score: float | None = None
    learning_signals: list[str] = Field(default_factory=list)
    aspirations: list[str] = Field(default_factory=list)
    # preferences (optional KO inputs)
    preferred_work_modes: list[str] = Field(default_factory=list)
    label: str = "Candidate"


class MatchResult(_Base):
    job_id: str
    title: str
    company: str = ""
    location: str = ""
    work_mode: str = ""
    seniority: str = ""
    role_family: str = ""
    salary_band: list[int] = Field(default_factory=list)
    total: int = 0
    skills_score: float = 0.0
    career_score: float = 0.0
    personal_score: float = 0.0
    confidence_low: int = 0
    confidence_high: int = 0
    matched_skills: list[str] = Field(default_factory=list)
    matched_skill_provenance: dict[str, str] = Field(default_factory=dict)
    missing_skills: list[str] = Field(default_factory=list)
    is_entry_eligible: bool = False
    graduate_friendliness: float = 0.0


class MatchResponse(_Base):
    candidate: dict[str, Any] = Field(default_factory=dict)
    meta: dict[str, Any] = Field(default_factory=dict)
    matches: list[MatchResult] = Field(default_factory=list)


# -- Layer A: KO filter -----------------------------------------------------


def _has_language(candidate_langs: list[str], required: str) -> bool:
    req = required.strip().casefold()
    if not req:
        return True
    bucket = next((aliases for key, aliases in _LANG_ALIASES.items() if key in req or req in key), None)
    needles = bucket if bucket else (req,)
    blob = " ".join(candidate_langs).casefold()
    return any(n in blob for n in needles)


def ko_filter(candidate: MatchCandidate, job: Job) -> tuple[bool, list[str]]:
    """Hard gates. Returns (passed, reasons-it-failed)."""
    reasons: list[str] = []
    cand_rank = _SENIORITY_RANK.get(candidate.seniority, 2)
    job_rank = _SENIORITY_RANK.get(job.seniority, 2)
    entry_ok = bool(job.entry_profile and job.entry_profile.is_entry_eligible)

    if candidate.archetype in _EARLY_CAREER:
        # Early-career: the seniority floor is REPLACED by "is the role open to
        # early-career?" (the precomputed entry lens). No seniority-gap penalty.
        if not entry_ok:
            reasons.append("role not open to early-career")
    else:
        # BAU seniority floor: don't surface roles two+ levels above the candidate,
        # unless the role is explicitly open to early-career.
        if not entry_ok and (job_rank - cand_rank) >= 2:
            reasons.append(f"seniority gap ({candidate.seniority} candidate vs {job.seniority} role)")

    # Minimum education (skip when the candidate's level is unknown — uncertainty).
    if job.min_education and job.min_education != "none":
        cand_edu = _EDU_RANK.get(candidate.education_level)
        if cand_edu is not None and cand_edu < _EDU_RANK.get(job.min_education, 0):
            reasons.append(f"below minimum education ({job.min_education})")

    # Required languages (lenient: skip when the candidate lists none).
    if candidate.languages:
        for lang in job.languages:
            if not _has_language(candidate.languages, lang):
                reasons.append(f"missing required language ({lang})")

    # Work-mode preference, only when the candidate expressed one.
    if candidate.preferred_work_modes and job.work_mode:
        if job.work_mode not in candidate.preferred_work_modes:
            reasons.append(f"work mode {job.work_mode} not preferred")

    return (len(reasons) == 0, reasons)


# -- Layer B: multi-factor scorer -------------------------------------------


def score_skills(candidate: MatchCandidate, job: Job) -> tuple[float, list[str], list[str]]:
    must_w, nice_w = 1.0, 0.4
    acc = 0.0
    total_w = 0.0
    matched: list[str] = []
    missing: list[str] = []
    for req in job.requirements:
        weight = must_w if req.kind == "must_have" else nice_w
        best = 0.0
        for cs in candidate.skills:
            prov = candidate.skill_provenance.get(cs, candidate.provenance_default)
            best = max(best, skill_match_score(cs, req.skill, prov))
        acc += best * weight
        total_w += weight
        if best >= _MATCH_THRESHOLD:
            matched.append(req.skill)
        elif req.kind == "must_have":
            missing.append(req.skill)
    score = (acc / total_w) if total_w else 0.0
    return round(score, 4), matched, missing


def score_career(candidate: MatchCandidate, job: Job) -> float:
    family = 1.0 if candidate.role_family == job.role_family else 0.35
    cand_rank = _SENIORITY_RANK.get(candidate.seniority, 2)
    job_rank = _SENIORITY_RANK.get(job.seniority, 2)
    seniority_proximity = 1.0 - abs(cand_rank - job_rank) / 3.0
    return round(0.6 * family + 0.4 * max(0.0, seniority_proximity), 4)


def score_personal(candidate: MatchCandidate, job: Job) -> float:
    """Lightweight heuristic until the embedding bridge lands.

    Blends language coverage with keyword overlap of the candidate's traits/skills
    against the role description. Deliberately modest and clearly a heuristic.
    """
    lang_cov = _language_coverage(candidate, job)
    desc = (job.description or "").casefold()
    tokens = [t for t in (candidate.traits + candidate.skills) if t]
    hits = sum(1 for t in tokens if t.casefold() in desc)
    overlap = min(1.0, hits / 5.0)
    return round(0.5 * lang_cov + 0.5 * overlap, 4)


def _language_coverage(candidate: MatchCandidate, job: Job) -> float:
    if not job.languages:
        return 1.0
    covered = sum(1 for lang in job.languages if _has_language(candidate.languages, lang))
    return covered / len(job.languages)


def score_motivation(candidate: MatchCandidate, job: Job) -> float:
    """Early-career 'personal' dimension: aspirations + domain fit + language coverage.

    Replaces the BAU description-keyword heuristic — a student's fit is better
    read from whether the role matches their stated target and field than from
    keyword overlap with an experience-oriented ad.
    """
    family_hit = 1.0 if candidate.role_family == job.role_family else 0.3
    asp = " ".join(candidate.aspirations).casefold()
    title = (job.title or "").casefold()
    asp_tokens = [t for t in asp.replace("/", " ").split() if len(t) > 3]
    aspiration_hit = 1.0 if asp_tokens and any(t in title for t in asp_tokens) else 0.0
    lang_cov = _language_coverage(candidate, job)
    return round(0.4 * family_hit + 0.35 * aspiration_hit + 0.25 * lang_cov, 4)


def weights_for(archetype: str) -> dict[str, float]:
    return WEIGHTS.get(archetype, WEIGHTS["bau"])


def _confidence_spread(candidate: MatchCandidate, missing_musts: list[str]) -> int:
    spread = 4
    if candidate.archetype in _EARLY_CAREER:
        spread += 6  # thinner, less-verifiable evidence -> wider honest band
    if len(candidate.skills) < 3:
        spread += 6
    if candidate.education_level == "unknown":
        spread += 4
    if not candidate.languages:
        spread += 4
    if len(missing_musts) > 2:
        spread += 5
    return spread


def score_job(candidate: MatchCandidate, job: Job) -> MatchResult:
    skills, matched, missing = score_skills(candidate, job)
    if candidate.archetype in _EARLY_CAREER:
        # career slot carries POTENTIAL (readiness); personal carries motivation/domain fit.
        career = candidate.potential_score if candidate.potential_score is not None else score_career(candidate, job)
        personal = score_motivation(candidate, job)
    else:
        career = score_career(candidate, job)
        personal = score_personal(candidate, job)
    w = weights_for(candidate.archetype)
    total = round(100 * (w["skills"] * skills + w["career"] * career + w["personal"] * personal))
    spread = _confidence_spread(candidate, missing)
    ep = job.entry_profile
    return MatchResult(
        job_id=job.id,
        title=job.title,
        company=job.company,
        location=job.location,
        work_mode=job.work_mode,
        seniority=job.seniority,
        role_family=job.role_family,
        salary_band=job.salary_band,
        total=total,
        skills_score=skills,
        career_score=career,
        personal_score=personal,
        confidence_low=max(0, total - spread),
        confidence_high=min(100, total + spread),
        matched_skills=matched,
        matched_skill_provenance={
            s: candidate.skill_provenance.get(s, candidate.provenance_default) for s in matched
        },
        missing_skills=missing,
        is_entry_eligible=bool(ep and ep.is_entry_eligible),
        graduate_friendliness=ep.graduate_friendliness if ep else 0.0,
    )


def candidate_assumptions(candidate: MatchCandidate) -> list[str]:
    """Imputations / uncertainties the recruiter should see to judge a score fairly."""
    out: list[str] = []
    if candidate.education_level == "unknown":
        out.append("Education level unknown — not penalized (absence of evidence, not a fail).")
    if not candidate.languages:
        out.append("No languages listed — language KO skipped rather than failed.")
    if candidate.archetype in _EARLY_CAREER:
        out.append("Early-career: potential replaces years of experience; only entry-eligible roles are considered.")
        if "self_declared" in set(candidate.skill_provenance.values()):
            out.append("Some skills are self-declared — discounted; validate them in interview.")
    if len(candidate.skills) < 3:
        out.append("Thin skill profile — scores carry a wide confidence band.")
    return out


def match(candidate: MatchCandidate, jobs: list[Job], *, limit: int = 50) -> MatchResponse:
    """Run the full KO -> score -> rank pipeline over a job corpus."""
    survivors: list[Job] = []
    ko_filtered = 0
    for job in jobs:
        passed, _reasons = ko_filter(candidate, job)
        if passed:
            survivors.append(job)
        else:
            ko_filtered += 1

    scored = sorted((score_job(candidate, job) for job in survivors), key=lambda m: m.total, reverse=True)
    top = scored[:limit]
    return MatchResponse(
        candidate={
            "label": candidate.label,
            "seniority": candidate.seniority,
            "roleFamily": candidate.role_family,
            "archetype": candidate.archetype,
            "skills": len(candidate.skills),
            "potentialScore": candidate.potential_score,
            "assumptions": candidate_assumptions(candidate),
        },
        meta={"evaluated": len(jobs), "koFiltered": ko_filtered, "survivors": len(survivors), "returned": len(top)},
        matches=top,
    )


# -- corpus loading ---------------------------------------------------------

_DEFAULT_CORPUS = Path(__file__).resolve().parents[2] / "data" / "seed_jobs" / "jobs.normalized.json"


def load_corpus(path: Path | None = None) -> list[Job]:
    """Load the normalized job corpus into :class:`Job` objects."""
    source = path or _DEFAULT_CORPUS
    records = json.loads(source.read_text(encoding="utf-8"))
    return [Job.model_validate(rec) for rec in records]
