"""Bridge: a completed live-case evaluation -> OBSERVED-provenance evidence.

The devcase pipeline designs a role-grounded work sample, runs it, and scores the
candidate's demonstrated capability (CaseEvaluation + TransferAssessment). Until
now that result was an island — a one-time screening gate that never enriched the
candidate's skill profile. This turns it into the highest-trust signal the scoring
engine knows: skills the candidate was OBSERVED to demonstrate get ``observed``
provenance (taxonomy weight 1.0, full match credit) and, for early-career
candidates, narrow the confidence band in ``matching._confidence``.

Honest by construction: observed credit is granted ONLY when the assessment itself
is trustworthy (its propagated confidence sits above ``models.LOW_CONFIDENCE`` — a
degraded/fallback evaluation is "a weak hint only", never the highest-trust signal),
when the candidate cleared the competence bar (``transfer_score >= threshold``), and
only for the role's must-have skills the transfer assessment actually says
transferred — never one it lists under ``gaps``. A weak performance adds NO observed
skills (we observed them not clear the bar) — it never penalises, it simply doesn't
fabricate evidence the candidate didn't earn.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import registry
from .devcase.models import LOW_CONFIDENCE, CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
from .profile import CandidateProfileV2, Evidence, normalize_profile

# Competence bar (0-100 transfer score) at/above which the live case grants observed
# credit. Sits at the matcher's "promising" tier — a coin-flip performance does not
# earn the highest-trust provenance.
OBSERVED_THRESHOLD = 65
LIVE_CASE_EVIDENCE_KIND = "live_case"

# Routing feedback: a passed work sample also corroborates the EARLY-CAREER ROUTING
# itself — an unsettled heuristic classification (low archetype_confidence, flagged
# for manual review) of someone who then DEMONSTRATES capability on the potential
# model is no longer an open routing question. The nudge is bounded: it never lifts
# confidence past the ceiling, which deliberately sits BELOW a real self-declaration
# (0.9, registry.py) — performing well is corroboration, not identity.
ROUTING_CONFIDENCE_LIFT = 0.15
ROUTING_CONFIDENCE_CEIL = 0.75

_EARLY_CAREER = registry.early_career_archetypes()


def _corroborate_routing(profile: CandidateProfileV2, note: str) -> None:
    """Append the routing-corroboration reason and apply the bounded confidence
    nudge. Only for early-career archetypes, and only when minting actually
    happened — a failed case must never touch the routing either way."""
    if profile.archetype not in _EARLY_CAREER:
        return
    profile.archetype_reasons.append(note)
    if profile.archetype_confidence < ROUTING_CONFIDENCE_CEIL:
        profile.archetype_confidence = round(
            min(ROUTING_CONFIDENCE_CEIL, profile.archetype_confidence + ROUTING_CONFIDENCE_LIFT), 2
        )


def _norm(s: str) -> str:
    return s.strip().casefold()


def _credited_skills(role: RoleSpec, transfer: TransferAssessment) -> list[str]:
    """The role's must-haves the assessment actually says transferred. Original
    casing preserved, order kept, de-duplicated.

    Two honesty rules, both anchored in the module contract ("only for the role's
    must-have skills the transfer assessment actually says transferred"):
      * a must-have the assessment lists under ``gaps`` is NEVER credited — the
        assessor explicitly said it did not transfer (gaps win over a
        contradictory ``transfers`` entry: credit must be earned, not inferred);
      * when no must-have matches an enumerated transfer, NOTHING is credited.
        The old ``matched or musts`` fallback inflated "we couldn't map the
        transfers onto the role's skills" into "every skill was observed" —
        always the case on the deterministic transfer path, whose ``transfers``
        are dimension labels ("Strong framing"), never skills."""
    musts = [m for m in role.must_haves if m and m.strip()]
    if not musts:
        return []
    transfers = [_norm(t) for t in transfer.transfers if t and t.strip()]
    gaps = [_norm(g) for g in transfer.gaps if g and g.strip()]
    matched = [m for m in musts if any(_norm(m) in t or t in _norm(m) for t in transfers)]
    return [m for m in matched if not any(_norm(m) in g or g in _norm(m) for g in gaps)]


def _level(score: int) -> str:
    return "strong" if score >= 75 else "working" if score >= 55 else "foundational"


# Machine-readable outcome reasons for the take-home minting gates — why credit was
# granted or withheld, so a caller can report a withheld credit instead of showing
# an indistinguishable silent no-op.
MINTED = "minted"
SKIP_LOW_CONFIDENCE = "low_confidence"
SKIP_BELOW_BAR = "below_bar"
SKIP_NO_TRANSFERRED_MUST_HAVES = "no_transferred_must_haves"


def _mint(
    role: RoleSpec,
    case: CaseScenario,
    evaluation: CaseEvaluation,
    transfer: TransferAssessment,
    *,
    threshold: int,
) -> tuple[Evidence | None, str]:
    """The minting gates in trust order, with the machine-readable reason.

    Confidence first: the transfer carries the PROPAGATED decision-confidence
    (models.py "Confidence scale" — the MIN of the upstream signals), so at/below
    ``LOW_CONFIDENCE`` the whole assessment is a thin/degraded hint and its score
    proves nothing, however high. Mirrors the interview path's wide-confidence
    kill in :func:`observed_from_interview` — the deeper-trust take-home path must
    not be the less-guarded one."""
    if transfer.confidence <= LOW_CONFIDENCE:
        return None, SKIP_LOW_CONFIDENCE
    if transfer.transfer_score < threshold:
        return None, SKIP_BELOW_BAR
    skills = _credited_skills(role, transfer)
    if not skills:
        return None, SKIP_NO_TRANSFERRED_MUST_HAVES
    level = _level(transfer.transfer_score)
    summary = (evaluation.summary or transfer.role_fit_rationale or "").strip()
    text = f"Live case '{case.title or 'work sample'}': demonstrated {level} capability on {', '.join(skills)}."
    if summary:
        text = f"{text} {summary}"
    evidence = Evidence(
        kind=LIVE_CASE_EVIDENCE_KIND,
        title=f"Live case: {case.title}" if case.title else "Live case",
        text=text,
        skills=skills,
        provenance="observed",
        # How sure we are the skills were demonstrated — scaled by the transfer score.
        confidence=round(min(0.95, transfer.transfer_score / 100.0), 2),
        recency="now",
    )
    return evidence, MINTED


def observed_evidence(
    role: RoleSpec,
    case: CaseScenario,
    evaluation: CaseEvaluation,
    transfer: TransferAssessment,
    *,
    threshold: int = OBSERVED_THRESHOLD,
) -> Evidence | None:
    """One ``observed``-provenance Evidence item for the skills the candidate
    demonstrated in the live case — or ``None`` when they didn't earn it (see
    :func:`_mint` for the gates: trustworthy confidence, competence bar, and
    must-haves the assessment actually says transferred)."""
    return _mint(role, case, evaluation, transfer, threshold=threshold)[0]


class MintOutcome(tuple):
    """``(updated profile, credited skills)`` exactly as before, plus a ``reason``
    field naming why credit was granted (``MINTED``) or withheld (one of the
    ``SKIP_*`` codes above). A plain 2-tuple subclass keeps the public contract
    backward-compatible: existing ``profile, credited = apply_live_case(...)``
    unpacking (devcase_cli observed-skills) works unchanged, while callers that
    want the failure narrative read ``.reason``."""

    reason: str

    def __new__(cls, profile: CandidateProfileV2, credited: list[str], reason: str) -> "MintOutcome":
        self = super().__new__(cls, (profile, credited))
        self.reason = reason
        return self


def apply_live_case(
    profile: CandidateProfileV2,
    role: RoleSpec,
    case: CaseScenario,
    evaluation: CaseEvaluation,
    transfer: TransferAssessment,
    *,
    threshold: int = OBSERVED_THRESHOLD,
) -> MintOutcome:
    """Append the earned observed-case evidence to ``profile`` and re-normalize.

    Returns ``(updated profile, credited skills)`` — a :class:`MintOutcome` whose
    ``reason`` field says why credit was granted or withheld; ``credited`` is empty
    when no credit was earned, so a caller can honestly report "no observed skills
    added" (and why) rather than implying a silent success."""
    ev, reason = _mint(role, case, evaluation, transfer, threshold=threshold)
    if ev is None:
        normalize_profile(profile)  # re-stamp completeness in place
        return MintOutcome(profile, [], reason)
    profile.evidence.append(ev)
    _corroborate_routing(
        profile,
        f"live case '{case.title or 'work sample'}' cleared the observed bar "
        f"(transfer {transfer.transfer_score}/100) — early-career routing corroborated",
    )
    normalize_profile(profile)  # re-stamp completeness in place
    return MintOutcome(profile, list(ev.skills), reason)


# --- Observed evidence from a CASE-GROUNDED interview -------------------------

# The constructs the case-grounded interview phases actually exercise — derived
# from the shared script (the caseGrounded phases' `feeds`), so this can never
# drift from what the agent really probed.
_SCRIPT = json.loads(Path(__file__).with_name("interview-script.json").read_text(encoding="utf-8"))
CASE_CONSTRUCTS: tuple[str, ...] = tuple(
    dict.fromkeys(feed for p in _SCRIPT["phases"] if p.get("caseGrounded") for feed in p["feeds"])
)

# A live conversation is lighter evidence than a take-home submission, so the bar
# is HIGHER than the take-home's "promising" threshold: every case construct must
# average "Above bar" (4/5) before the interview mints observed credit.
INTERVIEW_OBSERVED_MIN_RATING = 4.0


def observed_from_interview(
    role: RoleSpec,
    case: CaseScenario,
    scorecard: dict,
    *,
    min_rating: float = INTERVIEW_OBSERVED_MIN_RATING,
) -> Evidence | None:
    """``observed``-provenance Evidence from a case-grounded interview's scorecard.

    Honest gates, all required: the scorecard must not be wide-confidence (a thin
    transcript never mints); every case-fed construct must be rated on REAL quoted
    evidence (a backfilled "Not assessed" kills it); and their mean must clear
    ``min_rating``. Skills credited are the role's must-haves — the material the
    case (and therefore the interview's substance phases) was designed around."""
    confidence = scorecard.get("confidence") or {}
    if str(confidence.get("level") or "") == "wide":
        return None
    by_competency = {
        str(r.get("competency")): r for r in scorecard.get("ratings") or [] if isinstance(r, dict)
    }
    ratings: list[int] = []
    for construct in CASE_CONSTRUCTS:
        rating = by_competency.get(construct)
        if not rating:
            return None
        evidence_text = str(rating.get("evidence") or "")
        if not evidence_text.strip() or evidence_text.startswith("Not assessed"):
            return None
        try:
            ratings.append(max(1, min(5, int(rating.get("rating")))))
        except (TypeError, ValueError):
            return None
    mean = sum(ratings) / len(ratings)
    if mean < min_rating:
        return None
    skills = [m for m in role.must_haves if m and m.strip()]
    if not skills:
        return None
    level = "strong" if mean >= 4.5 else "working"
    summary = str(scorecard.get("summary") or "").strip()
    text = (
        f"Case-grounded interview '{case.title or 'work scenario'}': demonstrated {level} reasoning "
        f"on the shared case ({', '.join(CASE_CONSTRUCTS)} averaged {mean:.1f}/5) covering {', '.join(skills)}."
    )
    if summary:
        text = f"{text} {summary}"
    return Evidence(
        kind=LIVE_CASE_EVIDENCE_KIND,
        title=f"Case-grounded interview: {case.title}" if case.title else "Case-grounded interview",
        text=text,
        skills=skills,
        provenance="observed",
        # Capped below the take-home's 0.95: a strong live conversation is
        # first-hand, but lighter than a full submission we evaluated end-to-end.
        confidence=round(min(0.9, mean / 5.0), 2),
        recency="now",
    )


def apply_interview_case(
    profile: CandidateProfileV2,
    role: RoleSpec,
    case: CaseScenario,
    scorecard: dict,
    *,
    min_rating: float = INTERVIEW_OBSERVED_MIN_RATING,
) -> tuple[CandidateProfileV2, list[str]]:
    """Append the observed evidence a case-grounded interview earned (if any) and
    re-normalize. Mirrors :func:`apply_live_case` — ``credited`` is empty when the
    gates didn't pass, so the caller can report honestly."""
    ev = observed_from_interview(role, case, scorecard, min_rating=min_rating)
    if ev is None:
        normalize_profile(profile)  # re-stamp completeness in place
        return profile, []
    profile.evidence.append(ev)
    _corroborate_routing(
        profile,
        f"case-grounded interview '{case.title or 'work scenario'}' cleared the observed bar "
        f"— early-career routing corroborated",
    )
    normalize_profile(profile)  # re-stamp completeness in place
    return profile, list(ev.skills)
