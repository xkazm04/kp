from __future__ import annotations

from .models import (
    CandidateProfile,
    CompanyCompensationContext,
    EvidenceTrace,
    SalaryEstimate,
    ScoreBreakdown,
)
from .market_config import ACTIVE_MARKET
from .salary_band import round_salary
from .taxonomy import (
    COMPANY_ADJUSTMENTS,
    COMPANY_MODIFIER_EFFECTS,
    classify_company_type,
    company_modifiers,
)


# Defensive clamp so stacked modifiers can't push the company multiplier into
# unrealistic territory. The band is MARKET-calibrated (the Czech max, 1.20,
# aligns with the upper end of the Kitalent Prague multinational base premium —
# 30–40% over local mid-market, which Gemini already partly bakes into its raw
# range, so the multiplier sits on top of that), so it lives on MarketConfig
# beside the salary ceiling and re-homes when ACTIVE_MARKET flips instead of
# staying a hardcoded Czech literal.
_MAX_ADJUSTMENT = ACTIVE_MARKET.company_adjustment_max
_MIN_ADJUSTMENT = ACTIVE_MARKET.company_adjustment_min


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
    # Bail when there is no factor OR no actual band to adjust: the 0/0 "no
    # estimate" placeholder has nothing to scale, and without the maximum<=0 guard
    # we appended a rationale claiming an adjustment was applied to an empty band.
    if context is None or context.adjustment_factor == 1.0 or salary.maximum <= 0:
        return
    salary.minimum = round_salary(salary.minimum * context.adjustment_factor)
    salary.maximum = round_salary(salary.maximum * context.adjustment_factor)
    # Scale the midpoint by the SAME factor instead of re-deriving it as the mean of
    # the shifted bounds. pipeline._salary_from_payload deliberately KEEPS a
    # model-supplied midpoint whenever it falls inside the band — it is the model's
    # central estimate and is often off-centre — and re-deriving discarded exactly
    # that: a 90k-150k band with a 100k midpoint came back at 130k under the 1.11
    # enterprise factor, a 30% move the factor never asked for. The midpoint is the
    # HEADLINE figure (salary gauge marker, the Decisions peer-compare expectation,
    # and the group-eval over/within/under-band verdict), so that skew changes what a
    # recruiter reads. Clamped into the shifted band so the
    # `0 < min <= midpoint <= max` invariant (_salary_sanity_checks) still holds for
    # an already-broken input the way the old re-derivation did.
    salary.midpoint = min(
        salary.maximum,
        max(salary.minimum, round_salary(salary.midpoint * context.adjustment_factor)),
    )
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
