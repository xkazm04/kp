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
from .matching import MatchCandidate, candidate_assumptions, fairness_matrix, ko_filter, score_job


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
    # eligible first, then by score — the UI splits by archetype for fair comparison.
    rows.sort(key=lambda r: (r["koPassed"], r["result"]["total"]), reverse=True)
    return rows
