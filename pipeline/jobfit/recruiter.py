"""Recruiter-facing inverse of matching: one job -> ranked candidates (Phase 6).

Scores every supplied candidate against a single job and returns rows carrying
candidate identity, archetype, KO status, the dimension scores + confidence band,
matched-skill provenance, and the candidate-level assumptions — everything the
recruiter UI needs for a fair-comparison lens (early-career shown as its own
pipeline, never silently ranked on one number against experienced candidates).
"""

from __future__ import annotations

from typing import Any

from .jobs import Job
from .matching import (
    MatchCandidate,
    candidate_assumptions,
    fairness_matrix,
    ko_filter,
    propose_weights,
    score_job,
)


def fairness_check(candidates: list[tuple[str, MatchCandidate]], job: Job) -> dict[str, Any]:
    """Bounded dynamic weights per candidate + the cross-scheme fairness matrix.

    Each candidate gets a relevance-driven weight proposal (propose_weights) —
    e.g. a student with a relevant part-time / observed skill leans toward
    demonstrated skill. Because those vectors differ, a single weighted scalar
    isn't comparable, so fairness_matrix re-scores the whole pool under EVERY
    candidate's scheme and ranks by the mean. Returns the matrix plus the aligned
    candidateIds and the per-candidate weight-adjustment notes for the audit trail.
    A best-effort companion to rank_candidates_for_job — never required to decide."""
    proposals = [(cid, cand, *propose_weights(cand, job)) for cid, cand in candidates]
    matrix = fairness_matrix([(cand, weights) for _cid, cand, weights, _notes in proposals], job)
    matrix["candidateIds"] = [cid for cid, _cand, _w, _notes in proposals]
    matrix["weightNotes"] = {cid: notes for cid, _cand, _w, notes in proposals}
    return matrix


def rank_candidates_for_job(candidates: list[tuple[str, MatchCandidate]], job: Job) -> list[dict[str, Any]]:
    """``candidates`` are (candidate_id, MatchCandidate) pairs so rows can carry identity."""
    rows: list[dict[str, Any]] = []
    for candidate_id, candidate in candidates:
        passed, reasons = ko_filter(candidate, job)
        result = score_job(candidate, job)
        rows.append(
            {
                "candidateId": candidate_id,
                "label": candidate.label,
                "archetype": candidate.archetype,
                "seniority": candidate.seniority,
                "potentialScore": candidate.potential_score,
                "koPassed": passed,
                # KoReason objects carry a key + detail; the recruiter table shows
                # the plain detail string (JobsTypes.CandRow.koReasons: string[]).
                "koReasons": [r.detail for r in reasons],
                "assumptions": candidate_assumptions(candidate),
                "result": result.model_dump(by_alias=True, exclude_none=True),
            }
        )
    # eligible first, then by score — the UI splits by archetype for fair comparison.
    rows.sort(key=lambda r: (r["koPassed"], r["result"]["total"]), reverse=True)
    return rows
