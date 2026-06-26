"""Recruiter-facing inverse of matching: one job -> ranked candidates (Phase 6).

Scores every supplied candidate against a single job and returns rows carrying
candidate identity, archetype, KO status, the dimension scores + confidence band,
matched-skill provenance, and the candidate-level assumptions — everything the
recruiter UI needs for a fair-comparison lens (early-career shown as its own
pipeline, never silently ranked on one number against experienced candidates).
"""

from __future__ import annotations

from typing import Any

from . import weight_proposal
from .jobs import Job
from .matching import _EARLY_CAREER, MatchCandidate, candidate_assumptions, fairness_matrix, ko_filter, score_job


def fairness_track(archetype: str) -> str:
    """The fairness comparison TRACK a candidate belongs to. Early-career archetypes
    score their ``career`` slot as POTENTIAL (readiness), experienced ones as
    work-history fit — two incomparable 0-100 scales — so they must never be ranked
    against each other on one ``total``. Carrying the track on every row makes that
    contract structural (a consumer groups by it) instead of a UI-only convention."""
    return "early_career" if archetype in _EARLY_CAREER else "experienced"


def fairness_check(
    candidates: list[tuple[str, MatchCandidate]], job: Job, *, provider: Any | None = None
) -> dict[str, Any]:
    """Per-candidate dynamic weights + the cross-scheme fairness matrix.

    Each candidate gets a relevance-driven weight proposal — from the LLM proposer
    when ``provider`` is given (calibrated across the cohort), otherwise the
    deterministic matching.propose_weights. Because those vectors differ, a single
    weighted scalar isn't comparable, so fairness_matrix re-scores the whole pool
    under EVERY candidate's scheme (enforcing the per-archetype bounds) and ranks
    by the mean. Returns the matrix plus the aligned candidateIds, the per-candidate
    weight rationale, and whether the weights were LLM- or rule-derived. A
    best-effort companion to rank_candidates_for_job — never required to decide."""
    proposals, source = weight_proposal.generate(candidates, job, provider=provider)
    pairs = [(cand, proposals[cid]["weights"]) for cid, cand in candidates]
    matrix = fairness_matrix(pairs, job)
    matrix["candidateIds"] = [cid for cid, _cand in candidates]
    matrix["weightNotes"] = {cid: proposals[cid]["rationale"] for cid, _cand in candidates}
    matrix["weightSource"] = source
    return matrix


def rank_candidates_for_job(
    candidates: list[tuple[str, MatchCandidate]], job: Job, *, embedder: Any | None = None
) -> list[dict[str, Any]]:
    """``candidates`` are (candidate_id, MatchCandidate) pairs so rows can carry identity.

    ``embedder`` is the opt-in embedding bridge for the personal/motivation
    dimension (matching.score_job); omitted = the deterministic default."""
    rows: list[dict[str, Any]] = []
    for candidate_id, candidate in candidates:
        passed, reasons = ko_filter(candidate, job)
        result = score_job(candidate, job, embedder=embedder)
        rows.append(
            {
                "candidateId": candidate_id,
                "label": candidate.label,
                "archetype": candidate.archetype,
                # Fairness track carried on the row (not just the archetype string) so
                # any consumer — UI, CSV export, API client — can split early-career
                # from experienced instead of silently sorting them on one incomparable
                # total. See rank_candidates_by_track for the pre-grouped form.
                "track": fairness_track(candidate.archetype),
                "seniority": candidate.seniority,
                "potentialScore": candidate.potential_score,
                # SCOR3 — the WHY behind potentialScore (already on the
                # MatchCandidate; no recompute). Lets the ranking explain an
                # archetype-fair score instead of inviting overrides.
                "learningSignals": candidate.learning_signals,
                "transferableSkills": candidate.transferable_skills,
                "domainDistance": candidate.domain_distance,
                "koPassed": passed,
                # KoReason objects carry a key + detail; the recruiter table shows
                # the plain detail string (JobsTypes.CandRow.koReasons: string[]).
                "koReasons": [r.detail for r in reasons],
                "assumptions": candidate_assumptions(candidate),
                "result": result.model_dump(by_alias=True, exclude_none=True),
            }
        )
    # eligible first, then by score. Each row carries its `track`; for FAIR comparison
    # group by track (rank_candidates_by_track) — a flat sort mixes incomparable scales.
    rows.sort(key=lambda r: (r["koPassed"], r["result"]["total"]), reverse=True)
    return rows


def rank_candidates_by_track(
    candidates: list[tuple[str, MatchCandidate]], job: Job, *, embedder: Any | None = None
) -> dict[str, list[dict[str, Any]]]:
    """The fairness-safe shape: rank_candidates_for_job's rows grouped by fairness
    track (``early_career`` / ``experienced``), each already sorted within its track.
    A consumer that renders these never ranks a student against a senior on one
    incomparable ``total`` — the contract the docstring promised, now structural."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rank_candidates_for_job(candidates, job, embedder=embedder):
        grouped.setdefault(row["track"], []).append(row)
    return grouped
