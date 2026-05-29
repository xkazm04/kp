"""Layer C of the matching engine: per-match LLM reasoning (Phase 3b).

Given a candidate, a job, and the deterministic match scores, produce a concise
hiring rationale (verdict, strengths, gaps, interview probes). Uses an LLM
provider (ClaudeCliProvider by default — cheap on the subscription) and falls
back to a deterministic template when no provider is available or the call
fails, so the demo always returns something useful. Results are cached per
candidate x job by the API layer.
"""

from __future__ import annotations

from typing import Any

from .jobs import Job
from .matching import MatchCandidate, MatchResult

REASONING_PROMPT_VERSION = "match-reasoning-v1"

_SYSTEM = (
    "You are a precise technical recruiter for the Czech tech market. Give honest, "
    "specific hiring reasoning grounded only in the supplied facts. Write in English."
)


def reasoning_context(candidate: MatchCandidate, job: Job, m: MatchResult) -> dict[str, Any]:
    """Compact, factual inputs for the reasoning prompt (and the deterministic fallback)."""
    return {
        "candidate": {
            "seniority": candidate.seniority,
            "roleFamily": candidate.role_family,
            "yearsExperience": candidate.years_experience,
            "education": candidate.education_level,
            "skills": candidate.skills[:25],
        },
        "job": {
            "title": job.title,
            "seniority": job.seniority,
            "roleFamily": job.role_family,
            "mustHave": [r.skill for r in job.requirements if r.kind == "must_have"],
            "niceToHave": [r.skill for r in job.requirements if r.kind != "must_have"],
            "entryEligible": bool(job.entry_profile and job.entry_profile.is_entry_eligible),
        },
        "match": {
            "total": m.total,
            "skills": m.skills_score,
            "career": m.career_score,
            "personal": m.personal_score,
            "matchedSkills": m.matched_skills,
            "missingMustHaves": m.missing_skills,
        },
    }


def build_prompt(context: dict[str, Any]) -> str:
    import json

    return (
        "Assess this candidate against this job. Use ONLY these facts:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "Return JSON with exactly these keys:\n"
        '{ "verdict": str (one sentence overall judgement),\n'
        '  "strengths": [str] (2-4, concrete),\n'
        '  "gaps": [str] (1-4; if a required skill is missing, say so),\n'
        '  "interviewProbes": [str] (2-3 questions to validate fit / probe gaps) }\n'
        "Be specific and honest. JSON only."
    )


def deterministic_reasoning(context: dict[str, Any]) -> dict[str, Any]:
    """Template rationale used when no LLM is available — never fails."""
    match = context["match"]
    job = context["job"]
    total = match["total"]
    matched = match["matchedSkills"]
    missing = match["missingMustHaves"]
    same_family = context["candidate"]["roleFamily"] == job["roleFamily"]

    if total >= 70:
        verdict = f"Strong fit for {job['title']} — most requirements are covered."
    elif total >= 55:
        verdict = f"Promising fit for {job['title']}, with a few addressable gaps."
    else:
        verdict = f"Partial fit for {job['title']}; several core requirements are unmet."

    strengths: list[str] = []
    if same_family:
        strengths.append(f"Direct {job['roleFamily']} background aligns with the role.")
    if matched:
        strengths.append(f"Covers {len(matched)} of the role's skills: {', '.join(matched[:5])}.")
    if not strengths:
        strengths.append("Some transferable signal, but limited direct overlap.")

    gaps = [f"No clear evidence of {skill}." for skill in missing[:4]]
    if not gaps:
        gaps.append("No critical must-have gaps detected from the listed skills.")

    probes: list[str] = []
    for skill in missing[:2]:
        probes.append(f"Ask the candidate to describe hands-on experience with {skill}.")
    if matched:
        probes.append(f"Probe depth on {matched[0]} with a concrete recent example.")
    if not probes:
        probes.append("Probe a recent project end-to-end to gauge real depth.")

    return {"verdict": verdict, "strengths": strengths, "gaps": gaps, "interviewProbes": probes}


def _coerce(payload: Any, context: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return deterministic_reasoning(context)

    def _list(key: str) -> list[str]:
        v = payload.get(key)
        return [str(x).strip() for x in v if str(x).strip()] if isinstance(v, list) else []

    verdict = str(payload.get("verdict") or "").strip()
    out = {
        "verdict": verdict,
        "strengths": _list("strengths"),
        "gaps": _list("gaps"),
        "interviewProbes": _list("interviewProbes"),
    }
    # If the model under-delivered, backfill from the deterministic template.
    if not out["verdict"] or not out["strengths"]:
        fallback = deterministic_reasoning(context)
        out["verdict"] = out["verdict"] or fallback["verdict"]
        out["strengths"] = out["strengths"] or fallback["strengths"]
        out["gaps"] = out["gaps"] or fallback["gaps"]
        out["interviewProbes"] = out["interviewProbes"] or fallback["interviewProbes"]
    return out


def generate(
    candidate: MatchCandidate,
    job: Job,
    m: MatchResult,
    *,
    provider: Any | None = None,
) -> tuple[dict[str, Any], str]:
    """Return (reasoning, source) where source is 'llm' or 'deterministic'."""
    context = reasoning_context(candidate, job, m)
    if provider is None:
        return deterministic_reasoning(context), "deterministic"
    try:
        payload = provider.complete_json(build_prompt(context), system=_SYSTEM)
        return _coerce(payload, context), "llm"
    except Exception:
        return deterministic_reasoning(context), "deterministic"
