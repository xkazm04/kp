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
from .matching import MatchCandidate, MatchResult, fit_tier_for

REASONING_PROMPT_VERSION = "match-reasoning-v1"

_SYSTEM = (
    "You are a precise technical recruiter for the Czech tech market. Give honest, "
    "specific hiring reasoning grounded only in the supplied facts. Write in English."
)


_EARLY_CAREER = ("student", "career_switcher")


def reasoning_context(candidate: MatchCandidate, job: Job, m: MatchResult) -> dict[str, Any]:
    """Compact, factual inputs for the reasoning prompt (and the deterministic fallback)."""
    cand: dict[str, Any] = {
        "archetype": candidate.archetype,
        "seniority": candidate.seniority,
        "roleFamily": candidate.role_family,
        "yearsExperience": candidate.years_experience,
        "education": candidate.education_level,
        "skills": candidate.skills[:25],
    }
    if candidate.archetype in _EARLY_CAREER:
        cand["potentialScore"] = candidate.potential_score
        cand["learningSignals"] = candidate.learning_signals
        cand["aspirations"] = candidate.aspirations
        # how verifiable the matched skills are (academic/project vs professional)
        cand["skillProvenance"] = {
            s: candidate.skill_provenance.get(s, candidate.provenance_default) for s in m.matched_skills[:10]
        }
        if candidate.archetype == "career_switcher":
            cand["priorExperienceYears"] = candidate.years_experience
            cand["transferableSkills"] = candidate.transferable_skills
    return {
        "candidate": cand,
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

    archetype = context["candidate"].get("archetype")
    if archetype == "career_switcher":
        lens = (
            "This is a CAREER-SWITCHER (substantial experience in a DIFFERENT field, moving into this one). "
            "Lead with the BRIDGE NARRATIVE: how their prior-domain professional strengths (the transferable "
            "skills) de-risk the switch, which target-domain hard skills are genuinely new (treat like a "
            "graduate — provenance-discounted), and a realistic ramp-up. Credit meta-skills (communication, "
            "delivery, ownership) at professional level; do not treat them as a blank-slate beginner.\n\n"
        )
    elif archetype in _EARLY_CAREER:
        lens = (
            "This is an EARLY-CAREER candidate. Judge on POTENTIAL, not tenure: weigh demonstrated "
            "project/thesis work, learning trajectory, and degree relevance. Read skill provenance honestly "
            "(an academic-project skill is weaker evidence than a professional one). Frame gaps as LEARNABLE "
            "where reasonable, and recommend a junior/graduate/internship track. Be honest about uncertainty.\n\n"
        )
    else:
        lens = ""
    return (
        "Assess this candidate against this job. Use ONLY these facts:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        f"{lens}"
        "Return JSON with exactly these keys:\n"
        '{ "verdict": str (one sentence overall judgement),\n'
        '  "strengths": [str] (2-4, concrete),\n'
        '  "gaps": [str] (1-4; if a required skill is missing, say so),\n'
        '  "interviewProbes": [str] (2-3 questions to validate fit / probe gaps) }\n'
        "Be specific and honest. JSON only."
    )


def deterministic_reasoning(context: dict[str, Any]) -> dict[str, Any]:
    """Template rationale used when no LLM is available — never fails."""
    cand = context["candidate"]
    match = context["match"]
    job = context["job"]
    total = match["total"]
    matched = match["matchedSkills"]
    missing = match["missingMustHaves"]
    same_family = cand["roleFamily"] == job["roleFamily"]
    archetype = cand.get("archetype")

    if archetype == "career_switcher":
        pot = int(round((cand.get("potentialScore") or 0.0) * 100))
        transferable = cand.get("transferableSkills") or []
        years = cand.get("priorExperienceYears") or 0
        verdict = (
            f"Career-switcher into {job['roleFamily']}: prior professional maturity plus a foundation in the target "
            f"stack make this a realistic bridge (potential {pot}/100); expect a ramp-up."
        )
        strengths = []
        if transferable:
            strengths.append(f"Transferable professional strengths: {', '.join(transferable[:4])}.")
        if years:
            strengths.append(f"{years:g}y delivering in a prior career — proven ability to learn and ship.")
        if matched:
            strengths.append(f"Already has a foundation in {', '.join(matched[:4])}.")
        gaps = [f"{s} is new — learnable, but unproven in this domain." for s in missing[:4]]
        if not gaps:
            gaps.append("No hard must-have gaps; validate the depth of the newly-acquired skills.")
        probes = ["Why this switch now, and what have you already built in the new field?"]
        for s in missing[:1]:
            probes.append(f"How would you get production-ready on {s}, and how quickly?")
        probes.append("Give an example where your prior-domain experience would directly help in this role.")
        return {
            "verdict": verdict,
            "strengths": strengths or ["Mature professional moving into a new field."],
            "gaps": gaps,
            "interviewProbes": probes,
        }

    early_career = archetype in _EARLY_CAREER
    if early_career:
        pot = int(round((cand.get("potentialScore") or 0.0) * 100))
        if total >= 60:
            verdict = f"Promising early-career fit for {job['title']} (potential {pot}/100); recommend a junior/graduate track."
        else:
            verdict = f"Early-career candidate for {job['title']}; some foundation, but notable gaps to coach (potential {pot}/100)."
        strengths = []
        for sig in (cand.get("learningSignals") or [])[:2]:
            strengths.append(sig[0].upper() + sig[1:])
        if matched:
            strengths.append(f"Foundation in {', '.join(matched[:4])} (mostly from study/projects).")
        if same_family:
            strengths.append(f"Studies align with the {job['roleFamily']} target.")
        gaps = [f"{skill} not yet demonstrated — likely learnable on the job." for skill in missing[:4]]
        if not gaps:
            gaps.append("No hard must-have gaps; validate depth of the project-based skills.")
        probes = [f"Ask for a concrete example of using {s} in a project." for s in (matched[:1] + missing[:1])]
        probes.append("Probe one project end-to-end (their role, what they'd do differently).")
        return {
            "verdict": verdict,
            "strengths": strengths or ["Early-career foundation with room to grow."],
            "gaps": gaps,
            "interviewProbes": probes,
        }

    tier = fit_tier_for(total)
    if tier == "strong":
        verdict = f"Strong fit for {job['title']} — most requirements are covered."
    elif tier == "promising":
        verdict = f"Promising fit for {job['title']}, with a few addressable gaps."
    else:
        verdict = f"Partial fit for {job['title']}; several core requirements are unmet."

    strengths = []
    if same_family:
        strengths.append(f"Direct {job['roleFamily']} background aligns with the role.")
    if matched:
        strengths.append(f"Covers {len(matched)} of the role's skills: {', '.join(matched[:5])}.")
    if not strengths:
        strengths.append("Some transferable signal, but limited direct overlap.")

    gaps = [f"No clear evidence of {skill}." for skill in missing[:4]]
    if not gaps:
        gaps.append("No critical must-have gaps detected from the listed skills.")

    probes = []
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
