"""Candidate archetype router (Phase 4, diagram 07).

Routes a candidate to BAU / Student-early-career / Career-switcher, which then
selects the intake, transformation, scoring weights, and reasoning lens. The
detection is never silently final: an explicit self-declaration is trusted as
the primary signal (but contradictions are flagged), the candidate can override,
and a confidence is always returned for the recruiter to see.
"""

from __future__ import annotations

BAU = "bau"
STUDENT = "student"
CAREER_SWITCHER = "career_switcher"
ARCHETYPES = (BAU, STUDENT, CAREER_SWITCHER)

_LABELS = {
    BAU: "Experienced (BAU)",
    STUDENT: "Student / early-career",
    CAREER_SWITCHER: "Career-switcher",
}


def label_for(archetype: str) -> str:
    return _LABELS.get(archetype, archetype)


def detect_archetype(
    *,
    self_declared: str | None = None,
    years_relevant_experience: float | None = None,
    is_enrolled: bool | None = None,
    expected_graduation: str | None = None,
    education_is_dominant: bool | None = None,
    wants_domain_change: bool | None = None,
    has_substantial_experience: bool | None = None,
) -> tuple[str, float, list[str]]:
    """Return (archetype, confidence in [0,1], reasons).

    ``self_declared`` (one of ARCHETYPES) is primary; auto-signals still run to
    surface contradictions and lower confidence. With no declaration, the
    weighted signals decide and default to BAU when nothing is conclusive.
    """
    reasons: list[str] = []
    yre = years_relevant_experience

    if self_declared in ARCHETYPES:
        reasons.append(f"self-declared: {label_for(self_declared)}")
        confidence = 0.9
        if self_declared == STUDENT and (yre or 0) >= 3 and not is_enrolled:
            reasons.append("contradiction: 3+ years of relevant experience for a 'student'")
            confidence = 0.65
        if self_declared == BAU and (is_enrolled or (yre is not None and yre < 1)):
            reasons.append("contradiction: enrollment / <1y experience suggests early-career")
            confidence = 0.65
        if self_declared == CAREER_SWITCHER and not has_substantial_experience:
            reasons.append("note: 'switcher' usually implies prior professional experience")
            confidence = 0.7
        return self_declared, confidence, reasons

    scores = {BAU: 0.0, STUDENT: 0.0, CAREER_SWITCHER: 0.0}
    if is_enrolled:
        scores[STUDENT] += 2.0
        reasons.append("currently enrolled")
    if expected_graduation:
        scores[STUDENT] += 1.0
        reasons.append(f"expected graduation: {expected_graduation}")
    if yre is not None:
        if yre < 1:
            scores[STUDENT] += 1.5
            reasons.append("<1 year of relevant experience")
        elif yre >= 3:
            scores[BAU] += 1.5
            reasons.append(f"{yre:g} years of relevant experience")
    if education_is_dominant:
        scores[STUDENT] += 1.0
        reasons.append("education is the dominant CV block")
    if wants_domain_change and has_substantial_experience:
        scores[CAREER_SWITCHER] += 3.0
        reasons.append("wants a domain change and has substantial experience")
    elif wants_domain_change:
        scores[CAREER_SWITCHER] += 1.0
        reasons.append("wants a domain change")
    if has_substantial_experience:
        scores[BAU] += 1.0
        scores[CAREER_SWITCHER] += 0.5

    total = sum(scores.values())
    if total <= 0:
        reasons.append("no strong signal; defaulting to experienced")
        return BAU, 0.4, reasons

    best = max(ARCHETYPES, key=lambda a: scores[a])
    return best, round(scores[best] / total, 2), reasons
