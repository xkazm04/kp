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

from . import registry
from .i18n import language_directive
from .jobs import Job
from .matching import MatchCandidate, MatchResult, fit_tier_for
from .taxonomy import ROLE_FAMILY_DESCRIPTIONS

REASONING_PROMPT_VERSION = "match-reasoning-v2"


def _system_for(job: Job) -> str:
    """Industry/market-aware recruiter persona for the reasoning call.

    Replaces a hardcoded "Czech tech market" persona that biased every rationale
    (a nurse, tradesperson or consultant was reasoned about as if by a Czech tech
    recruiter). The lens is derived from the job's role family (the P0-1 catalog)
    and its market/location, and it demands a concrete, candidate-specific detail
    rather than generic boilerplate.
    """
    family_desc = ROLE_FAMILY_DESCRIPTIONS.get(job.role_family, "")
    family_label = family_desc.split(" — ")[0] if family_desc else job.role_family.replace("_", " ")
    market = f" in the {job.location} market" if (job.location or "").strip() else ""
    return (
        f"You are a precise recruiter assessing a candidate for a {job.seniority} {family_label} role{market}. "
        "Give honest, specific hiring reasoning grounded ONLY in the supplied facts and the candidate's CV "
        "highlights. Cite at least one concrete, candidate-specific detail rather than generic statements that "
        "would fit anyone. Match your lens to the role's industry and seniority. Write in the requested language."
    )


# Single-sourced from the shared registry (archetypes.json) — the same set matching.py
# scores on — so the reasoning lens can't silently diverge from the scorer when a new
# early-career archetype is added.
_EARLY_CAREER = registry.early_career_archetypes()


def reasoning_context(candidate: MatchCandidate, job: Job, m: MatchResult) -> dict[str, Any]:
    """Compact, factual inputs for the reasoning prompt (and the deterministic fallback)."""
    cand: dict[str, Any] = {
        "archetype": candidate.archetype,
        "seniority": candidate.seniority,
        "roleFamily": candidate.role_family,
        "yearsExperience": candidate.years_experience,
        "education": candidate.education_level,
        "skills": candidate.skills[:25],
        # Real CV content (not just tags) so the rationale can name a concrete,
        # candidate-specific fact and weigh a portfolio/repo, not generic boilerplate.
        "summary": candidate.summary,
        "experienceHighlights": candidate.experience_highlights[:5],
        "workLinks": candidate.work_links[:5],
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
            if candidate.domain_distance:
                cand["domainDistance"] = candidate.domain_distance
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
            "delivery, ownership) at professional level; do not treat them as a blank-slate beginner. "
            "domainDistance grades the bridge: 'adjacent' (neighbouring field — shorter ramp, some hard skills "
            "carry over), 'moderate' (meta-skills transfer, the domain doesn't), 'far' (plan the longest ramp); "
            "calibrate the narrative and the ramp-up estimate to it.\n\n"
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
        "Be specific and honest: cite at least one concrete detail from the candidate's "
        "experienceHighlights/summary (and their workLinks where relevant) — never generic "
        "boilerplate that would fit any candidate. JSON only."
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
        # Tier-aware (via the canonical fit_tier_for) so the verdict tracks the badge instead of
        # always reading as a 'realistic bridge': a 'partial' fit names the thin foundation up front.
        if fit_tier_for(total) == "partial":
            verdict = (
                f"Career-switcher into {job['roleFamily']}: prior professional maturity is a real asset, but the "
                f"target-stack foundation is still thin (potential {pot}/100) — core gaps to close before this is a "
                f"realistic bridge."
            )
        else:
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
        distance = cand.get("domainDistance")
        if distance == "adjacent":
            strengths.append("Prior field sits adjacent to the target — a shorter ramp than the switch label suggests.")
        gaps = [f"{s} is new — learnable, but unproven in this domain." for s in missing[:4]]
        if distance == "far":
            gaps.append("Prior field is distant from the target — the bridge runs through meta-skills; plan a longer ramp.")
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
        # Pin the verdict cutoff to the canonical fit band (fit_tier_for) — not an ad-hoc >=60 —
        # so the prose can't contradict the badge: a 'partial' tier reads as gaps-to-coach, while
        # 'promising'/'strong' reads as a fit. (A 57 is 'promising' in both badge and prose now.)
        if fit_tier_for(total) == "partial":
            verdict = f"Early-career candidate for {job['title']}; some foundation, but notable gaps to coach (potential {pot}/100)."
        else:
            verdict = f"Promising early-career fit for {job['title']} (potential {pot}/100); recommend a junior/graduate track."
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
    lang: str = "en",
    provider: Any | None = None,
) -> tuple[dict[str, Any], str]:
    """Return (reasoning, source) where source is 'llm' or 'deterministic'.

    ``lang`` is the output locale for the narrative (verdict/strengths/gaps are
    free-form); the verdict's canonical value stays English (it is coerced
    downstream). The deterministic fallback is English-only.
    """
    context = reasoning_context(candidate, job, m)
    if provider is None:
        return deterministic_reasoning(context), "deterministic"
    try:
        prompt = f"{build_prompt(context)}\n\n{language_directive(lang)}"
        payload = provider.complete_json(prompt, system=_system_for(job))
        return _coerce(payload, context), "llm"
    except Exception:
        return deterministic_reasoning(context), "deterministic"
