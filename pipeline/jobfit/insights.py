from __future__ import annotations

from .models import (
    CandidateProfile,
    CompanyCompensationContext,
    EvidenceTrace,
    SalaryEstimate,
    ScoreBreakdown,
)
from .taxonomy import (
    COMPANY_ADJUSTMENTS,
    COMPANY_MODIFIER_EFFECTS,
    classify_company_type,
    company_modifiers,
)


# Defensive cap so stacked modifiers can't push the company multiplier into
# unrealistic territory. 1.20 aligns with the upper end of the Kitalent
# Prague multinational base premium (30–40% over local mid-market, which
# Gemini already partly bakes into its raw range — the multiplier sits on
# top of that).
_MAX_ADJUSTMENT = 1.20
_MIN_ADJUSTMENT = 0.75


def build_company_context(company_text: str | None) -> CompanyCompensationContext | None:
    if not company_text or not company_text.strip():
        return None
    rationale: list[str] = []
    adjustment = 1.0

    company_type = classify_company_type(company_text)
    if company_type in COMPANY_ADJUSTMENTS:
        meta = COMPANY_ADJUSTMENTS[company_type]
        adjustment = meta["factor"]
        rationale.append(meta["rationale"])

    for modifier in company_modifiers(company_text):
        effect = COMPANY_MODIFIER_EFFECTS.get(modifier, {})
        adjustment += float(effect.get("factor_delta", 0.0))
        if effect.get("rationale"):
            rationale.append(effect["rationale"])

    capped = max(_MIN_ADJUSTMENT, min(_MAX_ADJUSTMENT, adjustment))
    if capped != adjustment:
        rationale.append(
            f"Capped cumulative multiplier at {capped:g} (raw stack was {adjustment:.2f}) to keep the band defensible."
        )
    adjustment = capped

    salary_effect = "neutral"
    if adjustment >= 1.06:
        salary_effect = "raises expected cash range"
    elif adjustment <= 0.94:
        salary_effect = "lowers expected cash range"

    return CompanyCompensationContext(
        company_type=company_type,
        salary_effect=salary_effect,
        adjustment_factor=round(adjustment, 2),
        rationale=rationale or ["No strong company compensation signal detected."],
    )


def apply_company_salary_context(salary: SalaryEstimate, context: CompanyCompensationContext | None) -> None:
    if context is None or context.adjustment_factor == 1.0:
        return
    salary.minimum = _round_salary(salary.minimum * context.adjustment_factor)
    salary.maximum = _round_salary(salary.maximum * context.adjustment_factor)
    salary.midpoint = _round_salary((salary.minimum + salary.maximum) / 2)
    salary.rationale.append(
        f"Applied company context factor {context.adjustment_factor:g} for {context.company_type}: {context.salary_effect}"
    )


def build_evidence_trace(profile: CandidateProfile, score: ScoreBreakdown, salary: SalaryEstimate) -> EvidenceTrace:
    return EvidenceTrace(
        experience=[
            f"{profile.years_experience:g} years detected",
            *[item for item in profile.evidence if item.lower().startswith("recent role focus")],
        ],
        skills=[f"{len(profile.skills)} skills matched: {', '.join(profile.skills[:12])}"],
        seniority=[f"Seniority inferred as {profile.current_seniority}; role seniority score {score.role_seniority}"],
        education=[f"Education inferred as {profile.education_level}; education score {score.education}"],
        salary=salary.rationale[:],
    )


def _round_salary(value: float) -> int:
    return int(round(value / 5000) * 5000)
