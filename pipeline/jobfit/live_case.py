"""Bridge: a completed live-case evaluation -> OBSERVED-provenance evidence.

The devcase pipeline designs a role-grounded work sample, runs it, and scores the
candidate's demonstrated capability (CaseEvaluation + TransferAssessment). Until
now that result was an island — a one-time screening gate that never enriched the
candidate's skill profile. This turns it into the highest-trust signal the scoring
engine knows: skills the candidate was OBSERVED to demonstrate get ``observed``
provenance (taxonomy weight 1.0, full match credit) and, for early-career
candidates, narrow the confidence band in ``matching._confidence``.

Honest by construction: observed credit is granted ONLY when the candidate cleared
the competence bar (``transfer_score >= threshold``), and only for the role's
must-have skills the transfer assessment actually says transferred. A weak
performance adds NO observed skills (we observed them not clear the bar) — it never
penalises, it simply doesn't fabricate evidence the candidate didn't earn.
"""

from __future__ import annotations

from .devcase.models import CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
from .profile import CandidateProfileV2, Evidence, normalize_profile

# Competence bar (0-100 transfer score) at/above which the live case grants observed
# credit. Sits at the matcher's "promising" tier — a coin-flip performance does not
# earn the highest-trust provenance.
OBSERVED_THRESHOLD = 65
LIVE_CASE_EVIDENCE_KIND = "live_case"


def _norm(s: str) -> str:
    return s.strip().casefold()


def _credited_skills(role: RoleSpec, transfer: TransferAssessment) -> list[str]:
    """The role's must-haves the assessment says transferred — or all must-haves when
    it didn't enumerate any. Original casing preserved, order kept, de-duplicated."""
    musts = [m for m in role.must_haves if m and m.strip()]
    if not musts:
        return []
    transfers = [_norm(t) for t in transfer.transfers if t and t.strip()]
    matched = [m for m in musts if any(_norm(m) in t or t in _norm(m) for t in transfers)]
    return matched or musts


def _level(score: int) -> str:
    return "strong" if score >= 75 else "working" if score >= 55 else "foundational"


def observed_evidence(
    role: RoleSpec,
    case: CaseScenario,
    evaluation: CaseEvaluation,
    transfer: TransferAssessment,
    *,
    threshold: int = OBSERVED_THRESHOLD,
) -> Evidence | None:
    """One ``observed``-provenance Evidence item for the skills the candidate
    demonstrated in the live case — or ``None`` when they didn't clear the bar."""
    if transfer.transfer_score < threshold:
        return None
    skills = _credited_skills(role, transfer)
    if not skills:
        return None
    level = _level(transfer.transfer_score)
    summary = (evaluation.summary or transfer.role_fit_rationale or "").strip()
    text = f"Live case '{case.title or 'work sample'}': demonstrated {level} capability on {', '.join(skills)}."
    if summary:
        text = f"{text} {summary}"
    return Evidence(
        kind=LIVE_CASE_EVIDENCE_KIND,
        title=f"Live case: {case.title}" if case.title else "Live case",
        text=text,
        skills=skills,
        provenance="observed",
        # How sure we are the skills were demonstrated — scaled by the transfer score.
        confidence=round(min(0.95, transfer.transfer_score / 100.0), 2),
        recency="now",
    )


def apply_live_case(
    profile: CandidateProfileV2,
    role: RoleSpec,
    case: CaseScenario,
    evaluation: CaseEvaluation,
    transfer: TransferAssessment,
    *,
    threshold: int = OBSERVED_THRESHOLD,
) -> tuple[CandidateProfileV2, list[str]]:
    """Append the earned observed-case evidence to ``profile`` and re-normalize.

    Returns ``(updated profile, credited skills)``; ``credited`` is empty when the
    performance was below the bar, so a caller can honestly report "no observed
    skills added" rather than implying a silent success."""
    ev = observed_evidence(role, case, evaluation, transfer, threshold=threshold)
    if ev is None:
        normalize_profile(profile)  # re-stamp completeness in place
        return profile, []
    profile.evidence.append(ev)
    normalize_profile(profile)  # re-stamp completeness in place
    return profile, list(ev.skills)
