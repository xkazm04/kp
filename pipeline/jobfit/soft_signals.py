"""Candidate-level soft-signal panel.

Aggregates the soft / behavioral *hypotheses* already scattered across the
pipeline (archetype contradictions, evidence provenance, the potential/transfer
engines) and adds three deterministic detectors that were missing — claim-vs-
evidence overclaim, tenure instability, and vague-vs-concrete delivery — into one
panel of ANTIPATTERNS and HIDDEN STRENGTHS.

Design stance (the whole point): a CV yields *hypotheses*, not verdicts. Every
signal carries a ``source`` (how it was inferred), a ``confidence``, a
``needs_confirmation`` flag, and a ``suggested_probe`` — so the panel routes to
the work-sample (devcase) and the interview rather than pretending to decide.
``probe_kind`` maps a signal to a devcase covert-probe kind when one fits, which
is what closes the CV-hypothesis -> targeted-probe loop (Rec B).

Deterministic and LLM-free, so it is cheap and unit-testable. If a ``JobFitResult``
is supplied, its LLM ``recruiter_risk_flags`` are folded in as lower-trust
hypotheses (clearly labelled ``cv-hypothesis``).
"""
from __future__ import annotations

import re

from .archetype import CAREER_SWITCHER, STUDENT

# The model classes + source/kind constants live in models.py so AnalysisResult
# can carry the panel without an import cycle (models -> soft_signals ->
# profile -> models). Re-exported here so this module remains the panel's
# public home for detectors AND types.
from .models import (  # noqa: F401 — re-exports are this module's public API
    ANTIPATTERN,
    BEHAVIORAL,
    CV_HYPOTHESIS,
    CV_STRUCTURAL,
    STRENGTH,
    SoftSignal,
    SoftSignalPanel,
)
from .profile import CandidateProfileV2
from .transferable import map_transferable
from .transform import compute_potential


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().casefold())


# Quantified-outcome markers: a delivery that moved a measurable number.
_METRIC_RE = re.compile(
    r"\d+\s?(?:%|percent|x\b|×|ms\b|s\b|k\b|m\b|×|users|req|rps|qps|/day|/s)"
    r"|\bp\d{2}\b"
    r"|\b(?:reduced|increased|cut|grew|scaled|improved|saved|doubled|tripled|halved|"
    r"snížil|zvýšil|zrychlil|zlepšil|ušetřil)\b",
    re.IGNORECASE,
)


def _evidence_blob(profile: CandidateProfileV2) -> str:
    return _norm(" ".join(f"{e.title} {e.text} {' '.join(e.skills)}" for e in profile.evidence))


# ---------------------------------------------------------------------------
# Antipattern detectors
# ---------------------------------------------------------------------------

def _claim_vs_evidence(profile: CandidateProfileV2) -> SoftSignal | None:
    """Skills self-rated STRONG that no evidence item backs up = overclaim risk."""
    if not profile.skill_claims:
        return None
    blob = _evidence_blob(profile)
    ev_skills = {_norm(s) for e in profile.evidence for s in e.skills}
    uncited = []
    for claim in profile.skill_claims:
        if claim.level != "strong":
            continue
        cs = _norm(claim.skill)
        cited = cs in ev_skills or any(cs in es or es in cs for es in ev_skills) or cs in blob
        if not cited:
            uncited.append(claim.skill)
    if not uncited:
        return None
    n = len(uncited)
    return SoftSignal(
        key="overclaim_risk",
        kind=ANTIPATTERN,
        label=f"{n} 'strong' skill claim(s) unbacked by any project or role",
        detail="Self-rated strong but not cited in any evidence item: " + ", ".join(uncited[:6]),
        evidence=uncited[:6],
        confidence=round(min(0.4 + 0.12 * n, 0.85), 2),
        source=CV_STRUCTURAL,
        needs_confirmation=True,
        suggested_probe=f"Deep-dive on {uncited[0]}: have them extend or debug real code using it — surface vs depth.",
        probe_kind="verification_trap",
    )


def _archetype_contradiction(profile: CandidateProfileV2) -> SoftSignal | None:
    """Surface the contradiction/mislabel reasons the archetype detector already found."""
    flags = [r for r in profile.archetype_reasons if r.lower().startswith(("contradiction", "note:"))]
    if not flags:
        return None
    return SoftSignal(
        key="archetype_contradiction",
        kind=ANTIPATTERN,
        label="Stated profile conflicts with the evidence",
        detail="; ".join(flags),
        evidence=flags,
        confidence=round(min(0.5 + 0.15 * len(flags), 0.8), 2),
        source=CV_HYPOTHESIS,
        needs_confirmation=True,
        suggested_probe="Clarify the timeline directly: enrolment dates vs professional roles.",
    )


def _evidence_thinness(profile: CandidateProfileV2) -> SoftSignal | None:
    """Low completeness or mostly self-declared skills = thin, unverifiable profile."""
    self_declared = sum(1 for c in profile.skill_claims if c.provenance == "self_declared")
    ratio = self_declared / len(profile.skill_claims) if profile.skill_claims else 0.0
    thin_completeness = profile.completeness and profile.completeness < 0.6
    mostly_self = ratio >= 0.6 and len(profile.skill_claims) >= 3
    if not (thin_completeness or mostly_self):
        return None
    bits = []
    if thin_completeness:
        bits.append(f"completeness {profile.completeness:.0%}")
    if mostly_self:
        bits.append(f"{ratio:.0%} of skills self-declared")
    return SoftSignal(
        key="evidence_thinness",
        kind=ANTIPATTERN,
        label="Thin / unverified evidence",
        detail="; ".join(bits),
        confidence=0.6,
        source=CV_STRUCTURAL,
        needs_confirmation=True,
        suggested_probe="Ask for one concrete artifact (repo, doc, demo) behind their top claimed skill.",
    )


def _tenure_instability(profile: CandidateProfileV2) -> SoftSignal | None:
    """Many roles in few years = possible job-hopping (best-effort, no structured dates)."""
    n_jobs = sum(1 for e in profile.evidence if e.kind == "job")
    years = profile.years_experience
    if n_jobs < 3 or not years or years <= 0:
        return None
    avg = years / n_jobs
    if avg >= 1.6:
        return None
    return SoftSignal(
        key="tenure_instability",
        kind=ANTIPATTERN,
        label=f"~{avg:.1f} yr average across {n_jobs} roles",
        detail="Short average tenure can signal flight risk — or fast growth. Confirm the reasons.",
        confidence=0.5,
        source=CV_STRUCTURAL,
        needs_confirmation=True,
        suggested_probe="Walk through the last three moves and the reason for each transition.",
    )


def _vague_delivery(profile: CandidateProfileV2) -> SoftSignal | None:
    """Work history with no quantified outcomes reads as vague / low-ownership."""
    work = [e for e in profile.evidence if e.kind in ("job", "project", "internship", "thesis")]
    if len(work) < 2:
        return None
    metric_hits = sum(len(_METRIC_RE.findall(f"{e.title} {e.text}")) for e in work)
    if metric_hits >= 1:
        return None  # has at least some concrete numbers — handled as a strength elsewhere
    return SoftSignal(
        key="vague_delivery",
        kind=ANTIPATTERN,
        label="No quantified outcomes in the work history",
        detail=f"{len(work)} roles/projects described without a single measurable result.",
        confidence=0.55,
        source=CV_STRUCTURAL,
        needs_confirmation=True,
        suggested_probe="For their proudest delivery, ask for the metric that moved and the baseline.",
    )


# ---------------------------------------------------------------------------
# Hidden-strength detectors
# ---------------------------------------------------------------------------

def _potential_strengths(profile: CandidateProfileV2) -> list[SoftSignal]:
    """Learning velocity / depth for early-career & switchers (reuses compute_potential)."""
    if profile.archetype not in (STUDENT, CAREER_SWITCHER):
        return []
    score, signals = compute_potential(profile)
    if not signals:
        return []
    return [
        SoftSignal(
            key="potential",
            kind=STRENGTH,
            label="Learning velocity & potential (beyond years of experience)",
            detail="; ".join(signals),
            evidence=signals,
            confidence=round(float(score), 2),
            source=CV_STRUCTURAL,
            needs_confirmation=False,
            suggested_probe="Probe self-directed learning: how they ramped on their newest skill.",
        )
    ]


def _transferable_strengths(profile: CandidateProfileV2) -> SoftSignal | None:
    """Career-switcher meta-skills from the prior domain, at professional grade."""
    if profile.archetype != CAREER_SWITCHER:
        return None
    mapped = [skill for skill, _src in map_transferable(profile.evidence)]
    if not mapped:
        return None
    return SoftSignal(
        key="transferable_strengths",
        kind=STRENGTH,
        label="Transferable meta-skills de-risk the switch",
        detail="Prior domain credits (professional-grade): " + ", ".join(mapped[:6]),
        evidence=mapped[:6],
        confidence=0.6,
        source=CV_STRUCTURAL,
        needs_confirmation=True,
        suggested_probe="Ask for a story where a prior-career strength solved a problem in the new field.",
    )


def _concrete_ownership(profile: CandidateProfileV2) -> SoftSignal | None:
    """Dense quantified outcomes = real ownership / impact (the inverse of vague_delivery)."""
    work = [e for e in profile.evidence if e.kind in ("job", "project", "internship", "thesis")]
    metric_hits = sum(len(_METRIC_RE.findall(f"{e.title} {e.text}")) for e in work)
    if metric_hits < 2:
        return None
    return SoftSignal(
        key="concrete_ownership",
        kind=STRENGTH,
        label=f"Quantified impact in {metric_hits} place(s)",
        detail="Delivery described with measurable outcomes — a real-ownership signal.",
        confidence=round(min(0.5 + 0.1 * metric_hits, 0.85), 2),
        source=CV_STRUCTURAL,
        needs_confirmation=False,
        suggested_probe="Pressure-test one metric: how it was measured and what they'd do differently.",
    )


def _folded_risk_flags(job_fit) -> list[SoftSignal]:
    """LLM recruiter risk flags from a job-fit analysis, as lower-trust hypotheses."""
    if job_fit is None:
        return []
    flags = [f for f in (getattr(job_fit, "recruiter_risk_flags", None) or []) if "no major" not in f.lower()]
    return [
        SoftSignal(
            key="llm_risk_flag",
            kind=ANTIPATTERN,
            label=flag if len(flag) < 80 else flag[:77] + "…",
            detail=flag,
            confidence=0.4,
            source=CV_HYPOTHESIS,
            needs_confirmation=True,
            suggested_probe="Address head-on in interview; ask for the closest counter-evidence.",
        )
        for flag in flags[:4]
    ]


def panel_to_probe_briefs(panel: SoftSignalPanel) -> list[dict]:
    """CV-hypothesis -> targeted devcase covert-probe briefs (the Rec B bridge).

    Only antipatterns that still need confirmation AND map to a devcase probe kind
    become briefs; everything else is interview-only (see ``to_interview_checklist``).
    Each brief is ``{kind, focus, rationale}`` — consumed by ``design_case(focus_probes=…)``.
    """
    briefs: list[dict] = []
    for s in panel.antipatterns:
        if s.needs_confirmation and s.probe_kind:
            briefs.append(
                {
                    "kind": s.probe_kind,
                    "focus": s.evidence[0] if s.evidence else s.label,
                    "rationale": s.suggested_probe,
                }
            )
    return briefs


def build_soft_signal_panel(profile: CandidateProfileV2, job_fit=None) -> SoftSignalPanel:
    """Aggregate antipatterns + hidden strengths for one candidate. Deterministic."""
    anti = [
        _claim_vs_evidence(profile),
        _archetype_contradiction(profile),
        _evidence_thinness(profile),
        _tenure_instability(profile),
        _vague_delivery(profile),
        *_folded_risk_flags(job_fit),
    ]
    strong = [
        *_potential_strengths(profile),
        _transferable_strengths(profile),
        _concrete_ownership(profile),
    ]
    antipatterns = [s for s in anti if s is not None]
    strengths = [s for s in strong if s is not None]
    n_confirm = sum(1 for s in antipatterns + strengths if s.needs_confirmation)
    summary = (
        f"{len(antipatterns)} antipattern(s), {len(strengths)} hidden strength(s); "
        f"{n_confirm} need interview/work-sample confirmation."
    )
    return SoftSignalPanel(
        display_name=profile.display_name,
        antipatterns=antipatterns,
        strengths=strengths,
        summary=summary,
    )
