from __future__ import annotations

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
from .salary_band import round_salary
from .taxonomy import (
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

        # Soft repairs collected across stages: one malformed LLM field should
        # degrade-and-flag, not abort the whole analysis. These surface in
        # sanity_checks so a human sees exactly what was repaired.
        repairs: list[str] = []

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
            keyword_coverage = _softly(
                "Keyword coverage",
                lambda: (
                    evaluate_keyword_coverage(
                        raw_text,
                        job_description_text,
                        list(build_profile(clean_text(job_description_text)).skills) or list(job_fit.matching_skills + job_fit.missing_skills),
                        job_fit.matching_skills,
                        job_fit.missing_skills,
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
            # never let the v2 add-on break the core analysis.
            v2_profile = _softly(
                "Archetype v2 profile",
                lambda: _v2_profile_from_payload(profile_payload, profile).model_dump(by_alias=True),
                sanity_checks,
            )
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
