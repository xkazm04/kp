"""LLM layer over the dynamic-weight contract: propose each candidate's weighting.

The matching engine scores three dimensions (skills, career/potential, personal/
motivation) with per-archetype baseline weights. For a fair early-career read the
RIGHT weighting is candidate-specific: a student who backs the role's must-haves
with high-trust, demonstrated (ideally observed) evidence should be scored more on
proven skill; one whose case rests on trajectory more on potential.

This layer asks an LLM to propose every candidate's weighting for ONE role in a
single call, so the weights are calibrated RELATIVE to the cohort, each with a
one-line rationale. The proposal is advisory only: matching.resolve_weights
enforces the per-archetype bounds downstream (a proposal can never erase or let a
dimension dominate), and matching.propose_weights is the always-available
deterministic fallback (no provider, empty pool, malformed output, or a failed
call). Mirrors match_reasoning.generate's shape.
"""

from __future__ import annotations

from typing import Any

from .jobs import Job
from .matching import MatchCandidate, propose_weights, score_job, weight_bounds, weights_for

WEIGHT_PROPOSAL_PROMPT_VERSION = "weight-proposal-v1"

_DIMENSION_KEYS = ("skills", "career", "personal")

_SYSTEM = (
    "You are a precise, fair technical recruiter for the Czech tech market. You tune how "
    "much each scoring dimension counts for each candidate, grounded ONLY in the supplied "
    "facts, and you never let one signal erase a dimension. Write in English."
)


def proposal_context(candidates: list[tuple[str, MatchCandidate]], job: Job) -> dict[str, Any]:
    """Compact, factual per-candidate inputs for the prompt (and parity with the fallback)."""
    must = [r.skill for r in job.requirements if r.kind == "must_have"]
    rows: list[dict[str, Any]] = []
    for cid, cand in candidates:
        m = score_job(cand, job)
        bounds = weight_bounds(cand.archetype)
        rows.append(
            {
                "candidateId": cid,
                "label": cand.label,
                "archetype": cand.archetype,
                "baselineWeights": weights_for(cand.archetype),
                # The hard guardrails: a proposal outside these is clamped downstream.
                "weightBounds": {k: list(bounds[k]) for k in _DIMENSION_KEYS},
                "dimensionScores": {
                    "skills": m.skills_score,
                    "career": m.career_score,
                    "personal": m.personal_score,
                },
                # Provenance of the must-haves they DO cover — observed/professional is
                # the case for leaning toward skills; self_declared/coursework is not.
                "matchedMustHaves": {
                    s: cand.skill_provenance.get(s, cand.provenance_default)
                    for s in m.matched_skills
                    if s in must
                },
                "missingMustHaves": m.missing_skills,
                "potentialScore": cand.potential_score,
            }
        )
    return {
        "role": {"title": job.title, "roleFamily": job.role_family, "mustHave": must},
        "dimensions": {
            "skills": "demonstrated skill match (provenance-weighted)",
            "career": "potential/readiness for early-career, else seniority + role-family fit",
            "personal": "motivation/domain fit for early-career, else job-description fit",
        },
        "candidates": rows,
    }


def build_prompt(context: dict[str, Any]) -> str:
    import json

    return (
        "Tune the scoring weights for EACH candidate for this one role. Use ONLY these facts:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "For each candidate propose weights for the three dimensions (skills, career, personal) that "
        "sum to 1.0 and stay within that candidate's weightBounds. Shift weight TOWARD skills when the "
        "role's must-haves are backed by high-trust, demonstrated evidence (observed > professional > "
        "internship/open_source); shift toward career/potential when the case rests on trajectory rather "
        "than proven skill; keep the baseline when there is no clear signal. Weights are a fairness lens, "
        "not a lever to inflate a favourite — never zero out a dimension.\n"
        'Return JSON: { "proposals": [ { "candidateId": str, "weights": { "skills": number, '
        '"career": number, "personal": number }, "rationale": str (ONE sentence citing the decisive '
        "evidence) } ] }. Cover every candidate, by candidateId. JSON only."
    )


def deterministic_proposals(
    candidates: list[tuple[str, MatchCandidate]], job: Job
) -> dict[str, dict[str, Any]]:
    """Relevance-driven proposal per candidate from matching.propose_weights — never fails."""
    out: dict[str, dict[str, Any]] = {}
    for cid, cand in candidates:
        weights, notes = propose_weights(cand, job)
        out[cid] = {"weights": weights, "rationale": notes}
    return out


def _coerce(
    payload: Any, candidates: list[tuple[str, MatchCandidate]], job: Job
) -> dict[str, dict[str, Any]]:
    fallback = deterministic_proposals(candidates, job)
    by_id: dict[str, dict[str, Any]] = {}
    if isinstance(payload, dict):
        for p in payload.get("proposals") or []:
            if not isinstance(p, dict):
                continue
            cid = p.get("candidateId")
            raw = p.get("weights")
            if cid is None or not isinstance(raw, dict):
                continue
            try:
                weights = {k: float(raw[k]) for k in _DIMENSION_KEYS}
            except (KeyError, TypeError, ValueError):
                continue
            rationale = str(p.get("rationale") or "").strip()
            by_id[str(cid)] = {"weights": weights, "rationale": [rationale] if rationale else []}
    # Backfill any candidate the model missed or garbled with the deterministic proposal,
    # so every candidate always has a (bounded-downstream) weighting.
    return {cid: by_id.get(cid) or fallback[cid] for cid, _cand in candidates}


def generate(
    candidates: list[tuple[str, MatchCandidate]],
    job: Job,
    *,
    provider: Any | None = None,
) -> tuple[dict[str, dict[str, Any]], str]:
    """Return ({candidateId: {weights, rationale}}, source) where source is 'llm' or
    'deterministic'. Weights are RAW proposals — resolve_weights enforces the bounds
    where they are applied (matching.fairness_matrix)."""
    if provider is None or not candidates:
        return deterministic_proposals(candidates, job), "deterministic"
    try:
        payload = provider.complete_json(build_prompt(proposal_context(candidates, job)), system=_SYSTEM)
        return _coerce(payload, candidates, job), "llm"
    except Exception:
        return deterministic_proposals(candidates, job), "deterministic"
