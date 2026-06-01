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
from typing import Any, Literal

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

# Display name for each scoring slot, per archetype. The three slots carry
# different meaning for early-career profiles (career -> POTENTIAL/readiness,
# personal -> motivation/domain fit; see score_job), so the label shifts with
# them. Emitted server-side on score_breakdown so every surface speaks one
# vocabulary and the client never re-guesses which archetype renames which bar.
DIMENSION_LABELS: dict[str, dict[str, str]] = {
    "bau": {"skills": "Skills", "career": "Career", "personal": "Personal"},
    "student": {"skills": "Foundation", "career": "Potential", "personal": "Fit"},
    "career_switcher": {"skills": "Foundation", "career": "Potential", "personal": "Fit"},
}
_DIMENSION_KEYS = ("skills", "career", "personal")
_EARLY_CAREER = ("student", "career_switcher")
# Per-requirement skill_match_score at/above which a requirement counts as
# "matched". 0.5 sits deliberately below 1.0 so taxonomy parent/sibling hits and
# provenance-discounted (e.g. self-declared) skills register as PARTIAL matches
# rather than misses — the matcher credits adjacent/credible skills, not just
# exact tokens. Consequently a "matched" skill at 0.5 is NOT proven hands-on
# possession; matched_skill_strength carries the per-skill score so the UI can
# distinguish a partial hit from an exact (1.0) one and recruiters don't read
# "matched: Kubernetes" as verified Kubernetes experience.
_MATCH_THRESHOLD = 0.5

# Score -> fit tier: the SINGLE SOURCE OF TRUTH for the strong/promising/partial
# banding every match surface renders (match cards, recruiter table, simulation).
# match_reasoning.py reads ``fit_tier_for`` for its verdict wording, and the tier +
# tone ride on MatchResult so the UI never re-derives these thresholds. ``tone``
# mirrors the frontend Badge vocabulary (app/_components/Badge.tsx BadgeTone) so one
# score yields one color + label + icon on every screen.
FIT_STRONG_THRESHOLD = 70
FIT_PROMISING_THRESHOLD = 55

FitTier = Literal["strong", "promising", "partial"]

_FIT_TONE: dict[str, str] = {"strong": "positive", "promising": "info", "partial": "caution"}


def fit_tier_for(total: int) -> FitTier:
    if total >= FIT_STRONG_THRESHOLD:
        return "strong"
    if total >= FIT_PROMISING_THRESHOLD:
        return "promising"
    return "partial"


def fit_tone_for(tier: str) -> str:
    return _FIT_TONE.get(tier, "neutral")


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
    # career-switcher: meta-skills mapped from a prior domain, credited at professional level.
    transferable_skills: list[str] = Field(default_factory=list)
    # preferences (optional KO inputs)
    preferred_work_modes: list[str] = Field(default_factory=list)
    label: str = "Candidate"


class ScoreDimension(_Base):
    """One row of the weight-aware score breakdown (see build_score_breakdown).

    Every number shares a single 0-100 scale so a bar chart renders with zero
    client-side math and no scale-mismatch guessing:

    * ``percent``      — how well this dimension scored, 0-100.
    * ``weight``       — its share of the total, 0-100 (the three sum to 100).
    * ``contribution`` — the points it adds to ``total`` (= percent x weight / 100;
      the three sum to ~total). This is the value a proportional bar should encode,
      so the highest-weighted, best-scoring dimension reads as visually dominant.

    ``key`` is the stable slot id (skills / career / personal); ``label`` is the
    archetype-aware display name (see DIMENSION_LABELS).
    """

    key: str
    label: str
    percent: int
    weight: int
    contribution: float


class Confidence(_Base):
    """Score uncertainty band plus the human reasons behind its width.

    ``level`` is a plain-language read of the band (tight / moderate / wide) and
    ``drivers`` are the specific reasons it is as wide as it is (early-career,
    thin skills, unknown education, …). The reasons used to be computed and then
    thrown away; surfacing them lets the UI explain a wide band instead of
    showing a bare number range, and stops recruiters over-reading a single
    point score.
    """

    low: int = 0
    high: int = 0
    level: str = "tight"  # tight | moderate | wide
    drivers: list[str] = Field(default_factory=list)


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
    # Server-computed banding so cards/recruiter/sim share one badge (see fit_tier_for).
    fit_tier: FitTier = "partial"
    tone: str = "caution"
    skills_score: float = 0.0
    career_score: float = 0.0
    personal_score: float = 0.0
    # Normalized, weight-aware view of the three scores above so the UI charts the
    # breakdown directly (no re-multiplying by server-side weights, no 0-1 vs 0-100
    # scale guessing). See build_score_breakdown.
    score_breakdown: list[ScoreDimension] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)
    matched_skills: list[str] = Field(default_factory=list)
    matched_skill_provenance: dict[str, str] = Field(default_factory=dict)
    # Per-matched-skill strength in [0,1]: 1.0 is an exact possession, lower
    # values are taxonomy/sibling or provenance-discounted partial hits (see
    # _MATCH_THRESHOLD). Lets the UI mark "matched" skills exact vs partial.
    matched_skill_strength: dict[str, float] = Field(default_factory=dict)
    missing_skills: list[str] = Field(default_factory=list)
    is_entry_eligible: bool = False
    graduate_friendliness: float = 0.0


class MatchResponse(_Base):
    candidate: dict[str, Any] = Field(default_factory=dict)
    meta: dict[str, Any] = Field(default_factory=dict)
    matches: list[MatchResult] = Field(default_factory=list)


KoReasonKey = Literal["language", "seniority", "early_career", "education", "work_mode"]


class KoReason(_Base):
    """One hard-gate failure, categorized AT BIRTH by ko_filter.

    ``key`` is the stable category rollups group by (aggregate_ko_reasons) — no
    English re-parsing downstream — and ``detail`` is the candidate-facing clause
    naming the specific value that tripped the gate. The two never need to agree
    on wording because the key alone is authoritative.
    """

    key: KoReasonKey
    detail: str


# -- Layer A: KO filter -----------------------------------------------------


def _has_language(candidate_langs: list[str], required: str) -> bool:
    req = required.strip().casefold()
    if not req:
        return True
    bucket = next((aliases for key, aliases in _LANG_ALIASES.items() if key in req or req in key), None)
    needles = bucket if bucket else (req,)
    blob = " ".join(candidate_langs).casefold()
    return any(n in blob for n in needles)


def ko_filter(candidate: MatchCandidate, job: Job) -> tuple[bool, list[KoReason]]:
    """Hard gates. Returns (passed, structured reasons-it-failed).

    Each failure is categorized at birth with a stable ``key`` (see KoReason), so
    rollups group by category directly instead of re-parsing English prose.
    """
    reasons: list[KoReason] = []
    cand_rank = _SENIORITY_RANK.get(candidate.seniority, 2)
    job_rank = _SENIORITY_RANK.get(job.seniority, 2)
    entry_ok = bool(job.entry_profile and job.entry_profile.is_entry_eligible)

    if candidate.archetype in _EARLY_CAREER:
        # Early-career: the seniority floor is REPLACED by "is the role open to
        # early-career?" (the precomputed entry lens). No seniority-gap penalty.
        if not entry_ok:
            reasons.append(KoReason(key="early_career", detail="role not open to early-career"))
    else:
        # BAU seniority floor: don't surface roles two+ levels above the candidate,
        # unless the role is explicitly open to early-career.
        if not entry_ok and (job_rank - cand_rank) >= 2:
            reasons.append(KoReason(key="seniority", detail=f"seniority gap ({candidate.seniority} candidate vs {job.seniority} role)"))

    # Minimum education (skip when the candidate's level is unknown — uncertainty).
    if job.min_education and job.min_education != "none":
        cand_edu = _EDU_RANK.get(candidate.education_level)
        if cand_edu is not None and cand_edu < _EDU_RANK.get(job.min_education, 0):
            reasons.append(KoReason(key="education", detail=f"below minimum education ({job.min_education})"))

    # Required languages (lenient: skip when the candidate lists none).
    if candidate.languages:
        for lang in job.languages:
            if not _has_language(candidate.languages, lang):
                reasons.append(KoReason(key="language", detail=f"missing required language ({lang})"))

    # Work-mode preference, only when the candidate expressed one.
    if candidate.preferred_work_modes and job.work_mode:
        if job.work_mode not in candidate.preferred_work_modes:
            reasons.append(KoReason(key="work_mode", detail=f"work mode {job.work_mode} not preferred"))

    return (len(reasons) == 0, reasons)


# -- Layer B: multi-factor scorer -------------------------------------------


def score_skills(candidate: MatchCandidate, job: Job) -> tuple[float, list[str], list[str], dict[str, float]]:
    must_w, nice_w = 1.0, 0.4
    acc = 0.0
    total_w = 0.0
    matched: list[str] = []
    missing: list[str] = []
    strength: dict[str, float] = {}  # matched skill -> its best match score (1.0 exact, lower = partial)
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
            strength[req.skill] = round(best, 2)
        elif req.kind == "must_have":
            missing.append(req.skill)
    score = (acc / total_w) if total_w else 0.0
    return round(score, 4), matched, missing, strength


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


def dimension_labels(archetype: str) -> dict[str, str]:
    return DIMENSION_LABELS.get(archetype, DIMENSION_LABELS["bau"])


def build_score_breakdown(
    archetype: str, skills: float, career: float, personal: float
) -> list[ScoreDimension]:
    """Project the three 0-1 dimension scores + archetype weights into a single
    0-100 breakdown the UI can chart directly.

    ``contribution`` and ``total`` are computed from the same un-rounded inputs, so
    the contributions sum to ``total`` (modulo independent rounding of each row).
    """
    w = weights_for(archetype)
    labels = dimension_labels(archetype)
    scores = {"skills": skills, "career": career, "personal": personal}
    return [
        ScoreDimension(
            key=key,
            label=labels[key],
            percent=round(100 * scores[key]),
            weight=round(100 * w[key]),
            contribution=round(100 * w[key] * scores[key], 1),
        )
        for key in _DIMENSION_KEYS
    ]


# Band-width labels keyed off the total spread. The base spread is 4 and each
# driver adds 4-6, so a "wide" band always carries >=2 drivers and "moderate"
# carries >=1 — the label and the reasons stay in sync.
_BAND_MODERATE_AT = 8
_BAND_WIDE_AT = 12


def _confidence(candidate: MatchCandidate, total: int, missing_musts: list[str]) -> Confidence:
    """Honest score band + the specific reasons it is wide.

    Each uncertainty source both widens the band and records a recruiter-readable
    driver, so the UI can explain *why* a score is uncertain rather than leaving
    a bare ``low–high`` range to be misread.
    """
    spread = 4
    drivers: list[str] = []
    if candidate.archetype in _EARLY_CAREER:
        spread += 6  # thinner, less-verifiable evidence -> wider honest band
        drivers.append("Early-career: thinner, less-verifiable track record")
    if len(candidate.skills) < 3:
        spread += 6
        drivers.append("Fewer than 3 skills listed")
    if candidate.education_level == "unknown":
        spread += 4
        drivers.append("Education level unknown")
    if not candidate.languages:
        spread += 4
        drivers.append("No languages listed")
    if len(missing_musts) > 2:
        spread += 5
        drivers.append(f"Misses {len(missing_musts)} must-have skills")
    level = "wide" if spread >= _BAND_WIDE_AT else "moderate" if spread >= _BAND_MODERATE_AT else "tight"
    return Confidence(
        low=max(0, total - spread),
        high=min(100, total + spread),
        level=level,
        drivers=drivers,
    )


def score_job(candidate: MatchCandidate, job: Job) -> MatchResult:
    skills, matched, missing, matched_strength = score_skills(candidate, job)
    if candidate.archetype in _EARLY_CAREER:
        # career slot carries POTENTIAL (readiness); personal carries motivation/domain fit.
        career = candidate.potential_score if candidate.potential_score is not None else score_career(candidate, job)
        personal = score_motivation(candidate, job)
    else:
        career = score_career(candidate, job)
        personal = score_personal(candidate, job)
    w = weights_for(candidate.archetype)
    total = round(100 * (w["skills"] * skills + w["career"] * career + w["personal"] * personal))
    breakdown = build_score_breakdown(candidate.archetype, skills, career, personal)
    tier = fit_tier_for(total)
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
        fit_tier=tier,
        tone=fit_tone_for(tier),
        skills_score=skills,
        career_score=career,
        personal_score=personal,
        score_breakdown=breakdown,
        confidence=_confidence(candidate, total, missing),
        matched_skills=matched,
        matched_skill_provenance={
            s: candidate.skill_provenance.get(s, candidate.provenance_default) for s in matched
        },
        matched_skill_strength=matched_strength,
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


# Candidate-facing clause shown after "{n} role(s)" for each KO category. The
# category KEY is recorded at birth by ko_filter (KoReason.key) — no English
# re-parsing — so this map is purely presentation. Declaration order is the
# tie-break when counts are equal; the count drives the real ranking.
_KO_REASON_CLAUSES: tuple[tuple[KoReasonKey, str], ...] = (
    ("language", "required a language not in the profile"),
    ("seniority", "sat outside the candidate's seniority range"),
    ("early_career", "weren't open to early-career candidates"),
    ("education", "required a higher education level"),
    ("work_mode", "didn't match the work-mode preference"),
)
_KO_CLAUSE_BY_KEY: dict[str, str] = dict(_KO_REASON_CLAUSES)
_KO_KEY_ORDER: dict[str, int] = {key: i for i, (key, _) in enumerate(_KO_REASON_CLAUSES)}


def aggregate_ko_reasons(reason_lists: list[list[KoReason]], *, top: int = 4) -> list[dict[str, Any]]:
    """Roll per-job KO reasons up into ranked ``{key, label, count}`` buckets.

    A job can trip several gates; each *category* it trips is counted once, so a
    count reads as "N roles were blocked by <reason>" rather than a raw hit total.
    Reasons carry their key from ko_filter, so this groups by key directly.
    Sorted by count desc, then the declaration order above for stability.
    """
    counts: dict[str, int] = {}
    for reasons in reason_lists:
        for key in {r.key for r in reasons}:  # one count per category per job
            counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts, key=lambda k: (-counts[k], _KO_KEY_ORDER.get(k, len(_KO_KEY_ORDER))))
    return [
        {"key": k, "label": _KO_CLAUSE_BY_KEY.get(k, "were filtered out for other reasons"), "count": counts[k]}
        for k in ranked[:top]
    ]


def match(candidate: MatchCandidate, jobs: list[Job], *, limit: int = 50) -> MatchResponse:
    """Run the full KO -> score -> rank pipeline over a job corpus."""
    survivors: list[Job] = []
    ko_reason_lists: list[list[KoReason]] = []
    for job in jobs:
        passed, reasons = ko_filter(candidate, job)
        if passed:
            survivors.append(job)
        else:
            ko_reason_lists.append(reasons)

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
        meta={
            "evaluated": len(jobs),
            "koFiltered": len(ko_reason_lists),
            "survivors": len(survivors),
            "returned": len(top),
            # Top KO blockers (with counts) so a 0/thin result can explain itself.
            "koReasons": aggregate_ko_reasons(ko_reason_lists),
        },
        matches=top,
    )


# -- corpus loading ---------------------------------------------------------

_DEFAULT_CORPUS = Path(__file__).resolve().parents[2] / "data" / "seed_jobs" / "jobs.normalized.json"


def load_corpus(path: Path | None = None) -> list[Job]:
    """Load the normalized job corpus into :class:`Job` objects."""
    source = path or _DEFAULT_CORPUS
    records = json.loads(source.read_text(encoding="utf-8"))
    return [Job.model_validate(rec) for rec in records]
