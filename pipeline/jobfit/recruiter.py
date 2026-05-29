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
from .matching import MatchCandidate, candidate_assumptions, ko_filter, score_job


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
                "koReasons": reasons,
                "assumptions": candidate_assumptions(candidate),
                "result": result.model_dump(by_alias=True, exclude_none=True),
            }
        )
    # eligible first, then by score — the UI splits by archetype for fair comparison.
    rows.sort(key=lambda r: (r["koPassed"], r["result"]["total"]), reverse=True)
    return rows
