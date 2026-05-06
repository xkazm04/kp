from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any, Callable

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
from .taxonomy import (
    ROLE_FAMILY_SET,
    classify_company_type,
    classify_role_family,
    company_modifiers,
    detected_signals,
    detected_skills,
    has_seniority_lead_signal,
    has_seniority_medior_signal,
    has_seniority_senior_signal,
    role_band,
)


ProgressCallback = Callable[[str, str], None]


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

    try:
        _emit(progress, "extract", "active")
        with StageTimer(timings, "extract"):
            pypdf_text = extract_text(path)
            evidence = _build_deterministic_evidence(pypdf_text, company_text)
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
            if len(raw_text) < 120:
                raise RuntimeError("Gemini profile text was too short for a useful assessment.")
            profile = _profile_from_payload(profile_payload, raw_text)
        _emit(progress, "profile", "done")

        _emit(progress, "scoring", "active")
        with StageTimer(timings, "scoring"):
            score = _score_from_payload(payload.get("score"))
        _emit(progress, "scoring", "done")

        _emit(progress, "salary", "active")
        with StageTimer(timings, "salary"):
            company_context = build_company_context(company_text)
            salary = _salary_from_payload(payload.get("salary"))
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

            sanity_checks = _sanity_checks(raw_text, score, salary)
            evidence_trace = build_evidence_trace(profile, score, salary)
            interview_kit = build_interview_kit(profile, job_fit)
            keyword_coverage = (
                evaluate_keyword_coverage(
                    raw_text,
                    job_description_text,
                    list(build_profile(clean_text(job_description_text)).skills) or list(job_fit.matching_skills + job_fit.missing_skills),
                    job_fit.matching_skills,
                    job_fit.missing_skills,
                )
                if job_description_text and job_fit
                else None
            )

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
        _emit(progress, "insights", "done")

        return AnalysisResult(
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


def _score_from_payload(raw: Any) -> ScoreBreakdown:
    if not isinstance(raw, dict):
        raise RuntimeError("Gemini analysis is missing the score section.")
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


def _salary_from_payload(raw: Any) -> SalaryEstimate:
    if not isinstance(raw, dict):
        raise RuntimeError("Gemini analysis is missing the salary section.")
    minimum = _optional_int(raw.get("minimum")) or 0
    maximum = _optional_int(raw.get("maximum")) or 0
    midpoint = _optional_int(raw.get("midpoint")) or _round_salary((minimum + maximum) / 2)
    if minimum <= 0 or maximum < minimum:
        raise RuntimeError("Gemini analysis returned an invalid salary range.")
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
        return float(value)
    except (TypeError, ValueError):
        return default


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
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


def _round_salary(value: float) -> int:
    return int(round(value / 5000) * 5000)


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
    skills_found = detected_skills(cleaned, limit=30)

    role_family = classify_role_family([], cleaned)

    seniority: str | None = None
    if has_seniority_lead_signal(cleaned):
        seniority = "lead"
    elif has_seniority_senior_signal(cleaned):
        seniority = "senior"
    elif has_seniority_medior_signal(cleaned):
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


def _sanity_checks(text: str, score: ScoreBreakdown, salary: SalaryEstimate) -> list[str]:
    checks = []
    checks.append("Profile text length OK" if len(text) >= 120 else "Profile text is short")
    checks.append("Score is inside 0-100" if 0 <= score.total <= 100 else "Score outside expected range")
    checks.append(
        "Salary range order OK"
        if 0 < salary.minimum <= salary.midpoint <= salary.maximum
        else "Salary range is inconsistent"
    )
    checks.append("Salary range seems plausible" if salary.maximum <= 350000 else "Salary range needs manual review")
    return checks
