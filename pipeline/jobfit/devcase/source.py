"""Phase C — proactive sourcing: turn a designed RoleSpec into a matchable Job and rank the
existing candidate DB against it. Deterministic (pure matching, no LLM) — it reuses the
core matching engine, so the Dev track's role design plugs straight into the app's matcher.
"""

from __future__ import annotations

from typing import Any

from ..jobs import Job, normalize_job
from ..matching import ko_filter, score_job
from ..profile import CandidateProfileV2
from ..transform import build_match_candidate


def role_to_job(role: dict) -> Job:
    """Normalize a RoleSpec into a Job the matcher understands."""
    reqs: list[dict] = []
    for skill in role.get("mustHaves") or []:
        reqs.append({"skill": skill, "kind": "must_have", "hardness": "prerequisite"})
    for skill in role.get("niceToHaves") or []:
        reqs.append({"skill": skill, "kind": "nice_to_have", "hardness": "learnable"})
    raw = {
        "title": role.get("title") or "Role",
        "seniority": role.get("seniority") or "medior",
        "role_family": role.get("roleFamily") or "software_engineering",
        "languages": role.get("languages") or ["English"],
        "description": " · ".join(role.get("responsibilities") or []) or (role.get("title") or ""),
        "requirements": reqs,
        "source": "dev-case",
    }
    return normalize_job(raw)


def source_candidates(role: dict, candidates: list[dict], *, top_n: int = 8, floor: int = 45) -> dict[str, Any]:
    """Rank the candidate pool against the role. `candidates` = [{id,label,archetype,payload}].

    Returns ``{"candidates": [...ranked...], "skipped": int, "skippedReasons": [...]}``.

    A candidate whose payload fails ``CandidateProfileV2`` validation is **not** silently
    dropped from the ranking: it is counted in ``skipped`` and recorded in ``skippedReasons``
    (one ``{candidateId, reason}`` per skip, where ``reason`` is the validation error type).
    That lets the caller tell "nobody qualified" (``candidates == []`` with ``skipped == 0``)
    apart from "the whole pool failed to parse" (``candidates == []`` with ``skipped > 0``).

    KO-filter and floor rejections are *not* skips — those candidates parsed fine, they
    just didn't make the cut — so they don't inflate the skipped count.
    """
    job = role_to_job(role)
    ranked: list[dict] = []
    skipped_reasons: list[dict] = []
    for pr in candidates:
        payload = pr.get("payload", pr)
        try:
            cand = build_match_candidate(CandidateProfileV2.model_validate(payload))
        except Exception as exc:
            skipped_reasons.append({"candidateId": pr.get("id"), "reason": type(exc).__name__})
            continue
        passed, _reasons = ko_filter(cand, job)
        if not passed:
            continue
        result = score_job(cand, job)
        if result.total < floor:
            continue
        ranked.append(
            {
                "candidateId": pr.get("id"),
                "label": pr.get("label") or payload.get("displayName") or pr.get("id"),
                "archetype": pr.get("archetype") or payload.get("archetype"),
                "score": result.total,
                "matchedSkills": result.matched_skills[:6],
            }
        )
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return {"candidates": ranked[:top_n], "skipped": len(skipped_reasons), "skippedReasons": skipped_reasons}
