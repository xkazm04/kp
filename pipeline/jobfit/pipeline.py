from __future__ import annotations

import math
import re
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

from .ats import evaluate_keyword_coverage
from .extractors import clean_text, extract_text
from .gemini import GEMINI_MODEL, analyze_profile_with_gemini
from .insights import (
    apply_company_salary_context,
    build_company_context,
    build_evidence_trace,
)
from .interview import build_interview_kit
from .logger import StageTimer, append_pipeline_log, new_request_id
from .models import (
    AnalysisMetadata,
    AnalysisResult,
    CandidateProfile,
    DeterministicEvidence,
    ExtractionComparison,
    ExtractionQuality,
    JobFitResult,
    MarketEvidence,
    SalaryEstimate,
    ScoreBreakdown,
)
from .profiling import build_profile
from .salary_band import SALARY_PLAUSIBILITY_CEILING, round_salary
from .taxonomy import (
    DEFAULT_FAMILY,
    ROLE_FAMILY_SET,
    classify_company_type,
    classify_role_family,
    company_modifiers,
    detected_signals,
    detected_skills,
    has_seniority_junior_signal,
    has_seniority_lead_signal,
    has_seniority_medior_signal,
    has_seniority_senior_signal,
    role_band,
)


ProgressCallback = Callable[[str, str], None]

_T = TypeVar("_T")

# Cap on the deterministic skill list fed into the Gemini prompt as a hint.
# Set below the taxonomy default (``DEFAULT_DETECTED_SKILLS_LIMIT`` = 40) to
# bound prompt size. No "+N more" indicator: this is an internal LLM hint, not a
# user-facing "complete" list, and Gemini's extraction supersedes it.
DETECTED_SKILLS_PREPASS_LIMIT = 30


def _softly(label: str, fn: Callable[[], _T | None], notes: list[str]) -> _T | None:
    """Run an optional, best-effort insight add-on.

    Each post-Gemini insight is cheap and deterministic; a bug in one must NOT
    discard an analysis whose expensive Gemini call already succeeded. On ANY
    exception this degrades the add-on to ``None`` and records a uniform
    ``"<label> unavailable — insight skipped (manual review)"`` note, so the
    fail-soft policy is one construct instead of a hand-copied try/except island
    a future add-on could forget to wrap. A clean ``None`` return (e.g. an input
    is absent) is NOT a degradation and records no note.
    """
    try:
        return fn()
    except Exception:
        notes.append(f"{label} unavailable — insight skipped (manual review)")
        return None


def _emit(progress: ProgressCallback | None, stage: str, status: str) -> None:
    if progress is None:
        return
    try:
        progress(stage, status)
    except Exception:  # never let progress reporting break the pipeline
        pass


def analyze_cv(
    path: Path,
    job_description_text: str | None = None,
    company_text: str | None = None,
    use_grounding: bool = False,
    progress: ProgressCallback | None = None,
) -> AnalysisResult:
    request_id = new_request_id()
    started = time.monotonic()
    timings: dict[str, int] = {}
    gemini_usage: dict[str, int] = {}
    error: str | None = None

    # Soft repairs/degradations collected across stages: a CV that pypdf can't
    # parse or a single malformed LLM field should degrade-and-flag, not abort the
    # whole analysis. These surface in sanity_checks so a human sees exactly what
    # was repaired or skipped. Declared before the first stage so the best-effort
    # extract pre-pass can record a note too.
    repairs: list[str] = []

    try:
        _emit(progress, "extract", "active")
        with StageTimer(timings, "extract"):
            pypdf_text, evidence = _extract_pre_pass(path, company_text, repairs)
        _emit(progress, "extract", "done")

        _emit(progress, "gemini", "active")
        with StageTimer(timings, "gemini"):
            payload, sources, gemini_usage = analyze_profile_with_gemini(
                path,
                job_description_text=job_description_text,
                company_text=company_text,
                use_grounding=use_grounding,
                evidence=evidence.model_dump(by_alias=True, exclude_none=True),
                request_id=request_id,
            )
        _emit(progress, "gemini", "done")

        _emit(progress, "profile", "active")
        with StageTimer(timings, "profile"):
            profile_payload = payload.get("profile") if isinstance(payload, dict) else None
            if not isinstance(profile_payload, dict):
                raise RuntimeError("Gemini analysis is missing the profile section.")
            raw_text_unclean = str(profile_payload.get("raw_text") or "")
            raw_text = clean_text(raw_text_unclean)
            if not raw_text:
                raise RuntimeError("Gemini analysis returned an empty profile.")
            if len(raw_text) < 120:
                repairs.append("Profile text was short — assessment may be less reliable (manual review)")
            profile = _profile_from_payload(profile_payload, raw_text)
        _emit(progress, "profile", "done")

        _emit(progress, "scoring", "active")
        with StageTimer(timings, "scoring"):
            score = _score_from_payload(payload.get("score"), repairs)
        _emit(progress, "scoring", "done")

        _emit(progress, "salary", "active")
        with StageTimer(timings, "salary"):
            company_context = build_company_context(company_text)
            salary = _salary_from_payload(payload.get("salary"), repairs)
            apply_company_salary_context(salary, company_context)
        _emit(progress, "salary", "done")

        _emit(progress, "insights", "active")
        job_fit = (
            _job_fit_from_payload(payload.get("job_fit"))
            if job_description_text
            else None
        )

        market_evidence = _market_evidence_from_payload(payload.get("market_evidence"), sources)

        with StageTimer(timings, "insights"):
            strengths = _string_list(payload.get("strengths"))
            gaps = _string_list(payload.get("gaps"))
            recommendations = _string_list(payload.get("recommendations"))
            explanation = str(payload.get("explanation") or "").strip() or _explanation_fallback(
                profile, score, salary, strengths, gaps, recommendations
            )

            extraction_quality = compare_extraction_quality(pypdf_text, raw_text, len(profile.skills))
            extraction_comparison = ExtractionComparison(
                pypdf_text=clean_text(pypdf_text),
                gemini_text=raw_text,
            )

            # Each post-Gemini insight below is a cheap, deterministic add-on. A
            # bug in one must NOT discard an analysis whose expensive Gemini call
            # already succeeded — _softly degrades the add-on to None and records
            # a uniform sanity-check note instead of crashing the analysis.
            evidence_trace = _softly(
                "Evidence trace", lambda: build_evidence_trace(profile, score, salary), repairs
            )
            interview_kit = _softly(
                "Interview kit", lambda: build_interview_kit(profile, job_fit), repairs
            )
            # Independent ATS check: no authoritative JD skill list is passed, so
            # evaluate_keyword_coverage harvests the JD keyword universe from the JD
            # text itself (the taxonomy's skill_keyword_pool). That lets the panel
            # surface a JD keyword the candidate — or the LLM — missed, rather than
            # re-checking only what the LLM already labelled.
            #
            # The old third argument — build_profile(clean_text(jd)).skills OR the
            # LLM's matching+missing lists — was a dead tautology: the regex builder
            # always returns skills=[], so that operand paid for a full profiling
            # pass whose result it then discarded, and the `or` fell through to the
            # LLM's own lists, making coverage_percent re-report what the LLM said.
            # matching_skills still augments literal CV matching; missing_skills
            # populates the missing list.
            keyword_coverage = _softly(
                "Keyword coverage",
                lambda: (
                    evaluate_keyword_coverage(
                        raw_text,
                        job_description_text,
                        matching_skills=job_fit.matching_skills,
                        missing_skills=job_fit.missing_skills,
                    )
                    if job_description_text and job_fit
                    else None
                ),
                repairs,
            )

            # Built last so helper-degrade notes collected above are included.
            sanity_checks = _sanity_checks(raw_text, score, salary) + repairs

            parsing_notes = _string_list(profile_payload.get("parsing_notes"))
            if market_evidence is not None and market_evidence.summary:
                parsing_notes.append(f"Grounded market context: {market_evidence.summary[:500]}")

            metadata = AnalysisMetadata(
                analysis_engine="gemini",
                text_extractor="gemini",
                model=GEMINI_MODEL,
                parsing_notes=parsing_notes,
                grounding_sources=sources,
                deterministic_evidence=evidence,
            )

            # Archetype-routed v2 profile so a CV-uploaded student/switcher is
            # scored fairly, not silently as an experienced hire. Best-effort —
            # never let the v2 add-on break the core analysis. The same add-on
            # also surfaces the routing's confidence (and whether any signal fired
            # at all) into sanity_checks, so a recruiter can verify a low-confidence
            # default rather than trust a silent "experienced hire".
            routing = _softly(
                "Archetype v2 profile",
                lambda: _v2_profile_and_routing(profile_payload, profile),
                sanity_checks,
            )
            if routing is None:
                v2_profile = None
            else:
                v2_profile, archetype_checks = routing
                sanity_checks.extend(archetype_checks)
        _emit(progress, "insights", "done")

        return AnalysisResult(
            v2_profile=v2_profile,
            candidate=profile,
            score=score,
            salary=salary,
            strengths=strengths,
            gaps=gaps,
            recommendations=recommendations,
            explanation=explanation,
            sanity_checks=sanity_checks,
            job_fit=job_fit,
            company_context=company_context,
            evidence_trace=evidence_trace,
            interview_kit=interview_kit,
            keyword_coverage=keyword_coverage,
            extraction_quality=extraction_quality,
            extraction_comparison=extraction_comparison,
            market_evidence=market_evidence,
            metadata=metadata,
        )
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        append_pipeline_log(
            {
                "request_id": request_id,
                "cv_path": path.name,
                "has_jd": bool(job_description_text and job_description_text.strip()),
                "has_company": bool(company_text and company_text.strip()),
                "grounding": bool(use_grounding),
                "duration_ms": int((time.monotonic() - started) * 1000),
                "stages_ms": timings,
                "gemini": {"model": GEMINI_MODEL, **gemini_usage},
                "status": "error" if error else "ok",
                "error": error,
            }
        )


def compare_extraction_quality(
    pypdf_text: str, gemini_text: str, gemini_skills: int
) -> ExtractionQuality:
    pypdf_spacing = _letter_spacing_hits(pypdf_text)
    gemini_spacing = _letter_spacing_hits(gemini_text)
    if gemini_spacing < pypdf_spacing:
        recommendation = "Prefer Gemini extraction for this document."
    elif pypdf_spacing == 0 and len(pypdf_text) >= len(gemini_text) * 0.9:
        recommendation = "pypdf extraction is sufficient for this document."
    else:
        recommendation = "Both extractors are usable; review profile evidence before relying on the score."
    return ExtractionQuality(
        pypdf_skills=0,
        gemini_skills=gemini_skills,
        pypdf_letter_spacing_hits=pypdf_spacing,
        gemini_letter_spacing_hits=gemini_spacing,
        pypdf_text_length=len(pypdf_text),
        gemini_text_length=len(gemini_text),
        recommendation=recommendation,
    )


def _letter_spacing_hits(text: str) -> int:
    return sum(1 for _ in re.finditer(r"\b(?:[^\W\d_]\s){3,}[^\W\d_]\b", text, flags=re.UNICODE))


def _profile_from_payload(payload: dict[str, Any], raw_text: str) -> CandidateProfile:
    """Build a CandidateProfile directly from the LLM payload.

    Skills, traits, languages, and evidence are taken verbatim from the LLM.
    Deterministic fields (name, years, seniority, role_family, education_level)
    fall back to the regex profiler only when the LLM omits them.
    """
    name = _optional_str(payload.get("name"))
    years_value = _optional_float(payload.get("years_experience"), -1.0)
    seniority_value = _choice_or_none(
        payload.get("current_seniority"),
        {"junior", "medior", "senior", "lead"},
    )
    role_family_value = _choice_or_none(payload.get("role_family"), ROLE_FAMILY_SET)
    education_value = _choice_or_none(
        payload.get("education_level"),
        {"phd", "master", "bachelor", "university", "unknown"},
    )

    needs_fallback = (
        name is None
        or years_value < 0
        or seniority_value is None
        or role_family_value is None
        or education_value is None
    )
    fallback = build_profile(raw_text) if needs_fallback else None

    return CandidateProfile(
        name=name or (fallback.name if fallback else None),
        raw_text=raw_text,
        years_experience=years_value if years_value >= 0 else (fallback.years_experience if fallback else 0.0),
        current_seniority=seniority_value or (fallback.current_seniority if fallback else "junior"),
        role_family=role_family_value or (fallback.role_family if fallback else next(iter(ROLE_FAMILY_SET))),
        skills=_string_list(payload.get("skills")),
        education_level=education_value or (fallback.education_level if fallback else "unknown"),
        languages=_string_list(payload.get("languages")),
        traits=_string_list(payload.get("traits")),
        evidence=_string_list(payload.get("evidence")),
    )


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("true", "yes", "1"):
            return True
        if v in ("false", "no", "0"):
            return False
    return None


def _infer_evidence_kind(text: str) -> str:
    """Map a flat evidence line to a v2 Evidence kind (fallback when the LLM omits structured experiences)."""
    t = (text or "").lower()
    if "intern" in t:
        return "internship"
    if "thesis" in t or "diplom" in t or "dissertation" in t:
        return "thesis"
    if "project" in t or "github" in t or "side " in t or "built" in t:
        return "project"
    if "course" in t or "bootcamp" in t or "mooc" in t:
        return "course"
    if "certif" in t:
        return "certification"
    if "volunteer" in t or "hackathon" in t or "club" in t or "community" in t:
        return "extracurricular"
    if any(w in t for w in (" at ", "engineer", "developer", "worked", "company", "years")):
        return "job"
    return "other"


def _v2_profile_from_payload(payload: dict[str, Any], profile: CandidateProfile) -> Any:
    """Build an archetype-routed v2 profile from the CV analysis (LLM signals + deterministic fallbacks)."""
    from .archetype import detect_archetype
    from .profile import (
        EVIDENCE_KINDS,
        SKILL_LEVELS,
        CandidateProfileV2,
        Evidence,
        SkillClaim,
        normalize_profile,
    )
    from .taxonomy import PROVENANCE_WEIGHTS

    years = profile.years_experience
    archetype, confidence, reasons = detect_archetype(
        self_declared=None,  # a CV has no self-declaration; infer from signals
        years_relevant_experience=years,
        is_enrolled=_as_bool(payload.get("is_enrolled")),
        expected_graduation=_optional_str(payload.get("expected_graduation")),
        education_is_dominant=_as_bool(payload.get("education_is_dominant")),
        wants_domain_change=_as_bool(payload.get("wants_domain_change")),
        has_substantial_experience=_as_bool(payload.get("has_substantial_experience")),
    )
    early = archetype in ("student", "career_switcher")
    default_prov = "self_declared" if early else "professional"
    prov_ok = set(PROVENANCE_WEIGHTS)

    raw_claims = payload.get("skill_claims")
    claims: list[Any] = []
    if isinstance(raw_claims, list):
        for c in raw_claims:
            if not isinstance(c, dict) or not c.get("skill"):
                continue
            prov = c.get("provenance")
            claims.append(
                SkillClaim(
                    skill=str(c["skill"]).strip(),
                    level=str(c.get("level")) if c.get("level") in SKILL_LEVELS else "working",
                    provenance=prov if prov in prov_ok else default_prov,
                )
            )
    if not claims:
        claims = [SkillClaim(skill=s, provenance=default_prov) for s in profile.skills if s]

    raw_exp = payload.get("experiences")
    evidence: list[Any] = []
    if isinstance(raw_exp, list):
        for e in raw_exp:
            if not isinstance(e, dict):
                continue
            evidence.append(
                Evidence(
                    kind=e.get("kind") if e.get("kind") in EVIDENCE_KINDS else "other",
                    title=str(e.get("title") or ""),
                    text=str(e.get("text") or ""),
                    skills=[str(s) for s in (e.get("skills") or []) if s],
                    link=_optional_str(e.get("link")),
                    recency=_optional_str(e.get("recency")),
                )
            )
    if not evidence:
        evidence = [Evidence(kind=_infer_evidence_kind(str(s)), text=str(s)) for s in profile.evidence]

    v2 = CandidateProfileV2(
        archetype=archetype,
        archetype_confidence=confidence,
        archetype_reasons=reasons,
        display_name=profile.name,
        role_family=profile.role_family,
        years_experience=years if years and years > 0 else None,
        seniority=profile.current_seniority,
        education_level=profile.education_level,
        education_detail=_optional_str(payload.get("education_detail")) or "",
        languages=profile.languages,
        skill_claims=claims,
        evidence=evidence,
    )
    normalize_profile(v2)
    return v2


def _v2_profile_and_routing(
    payload: dict[str, Any], profile: CandidateProfile
) -> tuple[dict[str, Any], list[str]]:
    """Build the archetype-routed v2 profile AND its routing sanity check together.

    Returned as one unit so the whole archetype add-on (detect + build + serialize
    + the confidence note) lives under a single :func:`_softly` umbrella: if any of
    it raises, the lot degrades to ``None`` plus the uniform skip note and the core
    analysis still ships. ``archetype_confidence``/``archetype_reasons`` are read
    off the built profile so the note can never disagree with what was routed.
    """
    v2 = _v2_profile_from_payload(payload, profile)
    checks = _archetype_sanity_checks(v2.archetype, v2.archetype_confidence, v2.archetype_reasons)
    from .profile import completeness_gaps

    dump = v2.model_dump(by_alias=True)
    # The unmet checklist items ride BESIDE the profile fields (transient key):
    # the intake UI renders one targeted follow-up field per gap, and pydantic
    # ignores the extra key when the completed profile is saved back through
    # profile_cli — so the gap list itself never persists.
    dump["completenessGaps"] = completeness_gaps(v2)
    return dump, checks


def _score_from_payload(raw: Any, repairs: list[str] | None = None) -> ScoreBreakdown:
    if not isinstance(raw, dict):
        if repairs is not None:
            repairs.append("Score section missing — defaulted to 0 (manual review)")
        raw = {}
    experience = _clamp_int(raw.get("experience"), 0, 25, 0)
    skills = _clamp_int(raw.get("skills"), 0, 30, 0)
    role_seniority = _clamp_int(raw.get("role_seniority"), 0, 23, 0)
    education = _clamp_int(raw.get("education"), 0, 12, 0)
    traits = _clamp_int(raw.get("traits"), 0, 10, 0)
    total = _clamp_int(
        raw.get("total"),
        0,
        100,
        min(experience + skills + role_seniority + education + traits, 100),
    )
    return ScoreBreakdown(
        total=total,
        experience=experience,
        skills=skills,
        role_seniority=role_seniority,
        education=education,
        traits=traits,
    )


def _salary_from_payload(raw: Any, repairs: list[str] | None = None) -> SalaryEstimate:
    had_section = isinstance(raw, dict)
    if not had_section:
        if repairs is not None:
            repairs.append("Salary section missing — estimate unavailable (manual review)")
        raw = {}
    minimum = _optional_int(raw.get("minimum")) or 0
    maximum = _optional_int(raw.get("maximum")) or 0
    # Repair an inconsistent range rather than aborting the whole analysis.
    if minimum > 0 and maximum > 0 and maximum < minimum:
        minimum, maximum = maximum, minimum
        if repairs is not None:
            repairs.append("Salary range was reversed — corrected (manual review)")
    if minimum <= 0 and maximum > 0:
        minimum = maximum
        if repairs is not None:
            repairs.append("Salary minimum missing — set to maximum (manual review)")
    elif maximum <= 0 and minimum > 0:
        maximum = minimum
    elif minimum <= 0 and maximum <= 0 and had_section and repairs is not None:
        repairs.append("Salary range missing — estimate unavailable (manual review)")
    midpoint = _optional_int(raw.get("midpoint")) or round_salary((minimum + maximum) / 2)
    return SalaryEstimate(
        currency=str(raw.get("currency") or "CZK"),
        period=str(raw.get("period") or "month"),
        minimum=minimum,
        maximum=maximum,
        midpoint=midpoint,
        confidence=str(raw.get("confidence") or "medium"),
        rationale=_string_list(raw.get("rationale")),
    )


def _job_fit_from_payload(raw: Any) -> JobFitResult | None:
    if not isinstance(raw, dict):
        return None
    return JobFitResult(
        score=_clamp_int(raw.get("score"), 0, 100, 0),
        summary=str(raw.get("summary") or ""),
        matching_skills=_string_list(raw.get("matching_skills")),
        missing_skills=_string_list(raw.get("missing_skills")),
        seniority_alignment=str(raw.get("seniority_alignment") or ""),
        role_alignment=str(raw.get("role_alignment") or ""),
        salary_assessment=str(raw.get("salary_assessment") or ""),
        recommendations=_string_list(raw.get("recommendations")),
        interview_talking_points=_string_list(raw.get("interview_talking_points")),
        cv_rewrite_suggestions=_string_list(raw.get("cv_rewrite_suggestions")),
        must_prove_evidence=_string_list(raw.get("must_prove_evidence")),
        negotiation_angle=str(raw.get("negotiation_angle") or ""),
        recruiter_risk_flags=_string_list(raw.get("recruiter_risk_flags")),
    )


def _market_evidence_from_payload(raw: Any, sources: list[str]) -> MarketEvidence | None:
    if not isinstance(raw, dict) and not sources:
        return None
    raw = raw if isinstance(raw, dict) else {}
    summary = str(raw.get("summary") or "").strip()
    if not summary and not sources:
        return None
    return MarketEvidence(
        summary=summary or "Grounded market context was returned.",
        suggested_minimum=_optional_int(raw.get("suggested_minimum_czk")),
        suggested_maximum=_optional_int(raw.get("suggested_maximum_czk")),
        confidence=str(raw.get("confidence") or "medium"),
        sources=sources,
        notes=_string_list(raw.get("notes")),
    )


def _explanation_fallback(
    profile: CandidateProfile,
    score: ScoreBreakdown,
    salary: SalaryEstimate,
    strengths: list[str],
    gaps: list[str],
    recommendations: list[str],
) -> str:
    candidate = profile.name or "Candidate"
    return (
        f"{candidate} was assessed as {profile.current_seniority} in {profile.role_family}. "
        f"Score {score.total}/100; salary estimate {salary.minimum:,}-{salary.maximum:,} {salary.currency}/month "
        f"({salary.confidence} confidence). Strengths: {'; '.join(strengths) or 'n/a'}. "
        f"Gaps: {'; '.join(gaps) or 'no critical gaps detected'}. "
        f"Next steps: {'; '.join(recommendations) or 'tighten the CV against the target role'}."
    )


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_float(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    # The grounded Gemini path decodes with a stock JSON decoder that admits
    # Infinity/NaN. A non-finite float passes every downstream `>= 0` guard and
    # formats as "inf years", so reject it here at the coercion boundary.
    return parsed if math.isfinite(parsed) else default


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    # `int(round(float('inf')))` raises OverflowError (NOT ValueError), and the
    # stock JSON decoder on the grounded path admits Infinity/NaN — so guard both
    # the non-finite value and the OverflowError before they abort the whole
    # analysis after the (expensive) Gemini call already succeeded.
    try:
        parsed = float(value)
        if not math.isfinite(parsed):
            return None
        return int(round(parsed))
    except (TypeError, ValueError, OverflowError):
        return None


def _clamp_int(value: Any, low: int, high: int, default: int) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        return default
    return max(low, min(high, parsed))


def _choice_or_none(value: Any, allowed: set[str] | frozenset[str]) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace(" ", "_")
    return text if text in allowed else None


# Forward-looking goal markers. A seniority title AFTER one of these ("aiming
# toward a Principal role", "looking to grow into a staff track") is the *target*
# of an aspiration, not the candidate's current level — so for seniority
# detection we keep only the text BEFORE the marker in each sentence.
_ASPIRATION_CUE = re.compile(
    r"\b("
    r"aspir\w*"
    r"|aiming\s+(?:to|toward|towards|for)"
    r"|looking\s+to\s+(?:lead|grow|move|become|transition|step|advance|own|take)"
    r"|hoping\s+to"
    r"|grow(?:ing)?\s+(?:in)?to"
    r"|grow(?:th)?\s+toward"
    r"|progress(?:ing)?\s+(?:in)?to"
    r"|next\s+(?:step|level)"
    r"|future\s+role"
    r"|long[-\s]term\s+goal"
    r"|career\s+goal"
    r"|rád[ao]?\s+bych"
    r"|chci\s+se\s+stát"
    r"|chtěl[ao]?\s+bych"
    r"|směřuj\w*"
    r"|usiluj\w*"
    r"|do\s+budoucna"
    r"|mým\s+cílem"
    r"|růst\s+směrem"
    r")",
    re.IGNORECASE,
)


def _current_level_text(cleaned: str) -> str:
    """Text used for *current* seniority detection: each sentence truncated at the
    first forward-looking goal marker, dropping the aspired title that follows it.

    "Senior engineer … aiming toward a Staff/Principal role." keeps "Senior
    engineer …" (real level) and drops "a Staff/Principal role" (the aspiration).
    """
    parts = re.split(r"(?<=[.!?])\s+|\n+", cleaned)
    kept: list[str] = []
    for part in parts:
        match = _ASPIRATION_CUE.search(part)
        segment = part[: match.start()] if match else part
        if segment.strip():
            kept.append(segment)
    return " ".join(kept)


def _short_error(exc: Exception) -> str:
    """A compact, single-line ``Type: message`` rendering of an exception.

    Used to name a fail-soft extraction error in a sanity-check note without
    spilling a multi-line traceback or an unbounded message into the result.
    """
    message = " ".join(str(exc).split())
    name = type(exc).__name__
    if not message:
        return name
    if len(message) > 120:
        message = message[:117] + "..."
    return f"{name}: {message}"


def _empty_deterministic_evidence() -> DeterministicEvidence:
    """The degraded pre-pass result: a DeterministicEvidence carrying no findings.

    Used when local extraction or the rule pre-pass fails, so the Gemini path
    (which reads the raw file bytes itself) can still run. ``detected_role_family``
    is required by the model, so it holds the taxonomy's default family as a
    neutral placeholder — not a detected signal.
    """
    return DeterministicEvidence(detected_role_family=DEFAULT_FAMILY)


def _extract_pre_pass(
    path: Path,
    company_text: str | None,
    notes: list[str],
) -> tuple[str, DeterministicEvidence]:
    """Best-effort local text extraction + deterministic rule pre-pass.

    The rule-based layer (pypdf/docx parse → taxonomy regexes) only PRIMES the
    Gemini prompt with deterministic findings; Gemini reads the raw file bytes
    itself, so it can often still analyze a document pypdf cannot. Encrypted,
    password-protected, or scanner-corrupt PDFs make pypdf throw (PdfReadError /
    FileNotDecryptedError), and the docx/zip readers fail the same way — but that
    must degrade the cheap pre-pass, not abort an analysis the LLM could finish.

    On an extraction failure we fall back to empty text + empty
    DeterministicEvidence; on a (rare) failure of the in-memory rule pass we keep
    the extracted text but still empty the evidence. Either way a sanity-check
    note is recorded and the Gemini path proceeds.
    """
    try:
        pypdf_text = extract_text(path)
    except Exception as exc:
        notes.append(
            f"Local text extraction failed ({_short_error(exc)}) — deterministic "
            "pre-pass skipped; relying on Gemini's own read of the document (manual review)"
        )
        return "", _empty_deterministic_evidence()
    try:
        evidence = _build_deterministic_evidence(pypdf_text, company_text)
    except Exception as exc:
        notes.append(
            f"Deterministic pre-pass failed ({_short_error(exc)}) — evidence findings "
            "skipped; Gemini analysis proceeds unprimed (manual review)"
        )
        evidence = _empty_deterministic_evidence()
    return pypdf_text, evidence


def _build_deterministic_evidence(
    raw_text: str,
    company_text: str | None,
) -> DeterministicEvidence:
    """Pre-pass that runs the taxonomy/regex layer over the extracted text.

    Output is fed into the Gemini prompt as "deterministic findings" so the
    LLM reconciles its reading with what the rules see, rather than inventing
    in a vacuum. Cheap; no I/O beyond what's already in memory.
    """
    cleaned = clean_text(raw_text)
    signals = detected_signals(cleaned)
    skills_found = detected_skills(cleaned, limit=DETECTED_SKILLS_PREPASS_LIMIT)

    role_family = classify_role_family([], cleaned)

    # Seniority for the salary anchor — kept deliberately conservative so the
    # anchor can't inflate the LLM's estimate beyond the candidate's real band:
    #  - Detection runs on the *current-level* text (aspired titles after "aiming
    #    toward …" stripped), so a goal to reach Staff/Principal isn't read as the
    #    candidate's level.
    #  - Entry markers (student/intern/trainee/junior) are high-precision and act
    #    as a FLOOR: a lone lead/senior token is otherwise usually a project verb.
    #  - "lead" must be corroborated by a senior-level signal — a genuine lead
    #    reads as senior+ — so a stray title token alone only reaches "senior".
    level_text = _current_level_text(cleaned)
    lead = has_seniority_lead_signal(level_text)
    senior = has_seniority_senior_signal(level_text)
    seniority: str | None = None
    if lead and senior:
        seniority = "lead"
    elif lead or senior:
        # Genuine senior/lead evidence wins over an incidental entry mention — a
        # senior who "mentored two junior engineers" is not a junior. A stray lead
        # title (uncorroborated by a senior signal) only reaches "senior".
        seniority = "senior"
    elif has_seniority_junior_signal(level_text):
        seniority = "junior"  # entry floor: junior markers and no senior/lead signal
    elif has_seniority_medior_signal(level_text):
        seniority = "medior"

    band = role_band(role_family, seniority) if seniority else None
    anchor = list(band) if band else []

    company_type: str | None = None
    company_mods: list[str] = []
    if company_text and company_text.strip():
        ct = classify_company_type(company_text)
        if ct != "unknown":
            company_type = ct
        company_mods = company_modifiers(company_text)

    return DeterministicEvidence(
        detected_role_family=role_family,
        detected_seniority=seniority,
        anchor_band=anchor,
        detected_signals=signals,
        detected_skills=skills_found,
        detected_company_type=company_type,
        detected_company_modifiers=company_mods,
    )


# Largest gap (in score points) tolerated between the headline total and the sum
# of its five components before it is flagged for manual review. The contract is
# total == experience+skills+role_seniority+education+traits (whose maxima
# 25+30+23+12+10 sum to exactly 100), but _score_from_payload takes the model's
# own clamped total rather than recomputing it, so a bad generation can hand back
# a headline number that contradicts its own breakdown. A couple of points absorbs
# trivial model rounding; a wider gap is a real contradiction — the score dial
# telling a different story than the factor bars — and is surfaced for a human.
SCORE_TOTAL_TOLERANCE = 2


def _sanity_checks(text: str, score: ScoreBreakdown, salary: SalaryEstimate) -> list[str]:
    checks = []
    checks.append("Profile text length OK" if len(text) >= 120 else "Profile text is short")
    checks.extend(_score_sanity_checks(score))
    checks.extend(_salary_sanity_checks(salary))
    return checks


def _score_sanity_checks(score: ScoreBreakdown) -> list[str]:
    """Sanity-state the fit score: its 0-100 range AND whether the headline total
    agrees with its own breakdown.

    ``_score_from_payload`` takes the model's own ``total`` (clamped to 0-100)
    rather than recomputing it from the five components, so a bad generation can
    return a total that contradicts its parts — e.g. a 95 sitting above components
    that sum to 40. The web UI pins the *displayed* total to the component sum so
    the dial can't visibly disagree with the bars (see ``reconcileScoreTotal`` in
    app/_lib/format.ts), but that divergence is otherwise silent in the result.
    Flag it here for manual review when it exceeds :data:`SCORE_TOTAL_TOLERANCE`,
    turning a quiet data-integrity defect into a visible, reviewable one. A total
    re-derived from the parts (when the model omits it) sums exactly and never
    trips this.
    """
    component_sum = (
        score.experience
        + score.skills
        + score.role_seniority
        + score.education
        + score.traits
    )
    divergence = abs(score.total - component_sum)
    return [
        "Score is inside 0-100" if 0 <= score.total <= 100 else "Score outside expected range",
        "Score total matches its breakdown"
        if divergence <= SCORE_TOTAL_TOLERANCE
        else (
            f"Score total ({score.total}) disagrees with its breakdown "
            f"(components sum to {component_sum}, off by {divergence}) — "
            "verify the score before trusting it"
        ),
    ]


def _archetype_sanity_checks(
    archetype: str, confidence: float, reasons: list[str]
) -> list[str]:
    """Surface how the candidate was routed to an archetype so an uncertain
    auto-detection is visible to the recruiter acting on the score.

    The CV path auto-detects the archetype from best-effort Gemini booleans that
    are frequently null; when no early-career signal fires, detection falls back to
    the registry default (Experienced/BAU at a low confidence) — silently scoring a
    student or career-switcher as an experienced hire. This always states the
    routing and its confidence, and flags it for human verification when EITHER the
    confidence is below the registry's low-confidence threshold OR no detection
    signal fired at all. The signals-absent guard is independent of the numeric
    threshold so an unguided default stays flagged even if its confidence were ever
    tuned upward.
    """
    from . import registry
    from .archetype import label_for

    label = label_for(archetype)
    pct = round(confidence * 100)
    absent = registry.signals_absent(reasons)
    low = confidence < registry.low_confidence_threshold()
    if absent or low:
        why = "no detection signals fired" if absent else "weak signals"
        return [
            f"Archetype routing is low-confidence — {label} at {pct}% ({why}); "
            "verify the candidate's archetype before trusting the score"
        ]
    return [f"Archetype routing OK — {label} at {pct}% confidence"]


def _salary_sanity_checks(salary: SalaryEstimate) -> list[str]:
    """Sanity-state the salary band, keeping three outcomes distinct.

    - *No estimate*: Gemini surfaced no comp signal, so ``_salary_from_payload``
      hands back the zero/zero placeholder. That is a legitimate "nothing to
      say" — NOT a malformed range — and gets its own explicit state so a
      recruiter reads it as "no comp data", never "the analysis is broken".
    - *Inconsistent*: a populated band whose endpoints fail
      ``0 < min <= midpoint <= max`` — a genuinely broken range.
    - *Implausible*: an order-valid band whose top exceeds the documented
      :data:`SALARY_PLAUSIBILITY_CEILING` (likely a yearly figure or stray zero),
      flagged for manual review.

    The empty case returns a single state and skips the plausibility line, since
    calling a non-existent band "plausible" would be misleading.
    """
    if salary.minimum <= 0 and salary.maximum <= 0:
        return ["No salary estimate produced"]
    order_ok = 0 < salary.minimum <= salary.midpoint <= salary.maximum
    plausible = salary.maximum <= SALARY_PLAUSIBILITY_CEILING
    return [
        "Salary range order OK" if order_ok else "Salary range is inconsistent",
        "Salary range seems plausible" if plausible else "Salary range needs manual review",
    ]
