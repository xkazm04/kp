"""LLM-driven HR automation for the hiring pipeline (Direction 2).

Local-first: the ONLY runtime LLM engine is the Claude Code CLI via
ClaudeCliProvider. Every LLM task ships a deterministic fallback (mirroring
match_reasoning.generate) so the pipeline never blocks when the CLI is absent
(provider=None => deterministic path). Task 7 (policy pass) is pure-deterministic.

Fairness is enforced in code, not left to the model: early-career candidates
(student / career_switcher) are never silently advanced or rejected by automation.

See docs/AUTOMATION_SPEC.md for the full design.
"""

from __future__ import annotations

import json
from typing import Any

from .jobs import Job
from .matching import MatchCandidate, ko_filter, score_job
from .match_reasoning import generate as generate_reasoning
from .match_reasoning import reasoning_context

SCREENING_PROMPT_VERSION = "screening-v1"
OUTREACH_PROMPT_VERSION = "outreach-v1"
REJECTION_PROMPT_VERSION = "rejection-v1"
PREP_PROMPT_VERSION = "interview-prep-v1"
SCORECARD_PROMPT_VERSION = "scorecard-v1"
REMATCH_PROMPT_VERSION = "rematch-v1"
OFFER_PROMPT_VERSION = "offer-v1"

# Task 7 thresholds — tunable per market/season (the only place rules live).
POLICY: dict[str, int] = {
    "bau_advance_score": 70,
    "bau_advance_conf_low": 65,
    "bau_reject_score": 40,
    "screening_auto_days": 2,
    "stale_days": 21,
    "aging_days": 30,
    "rematch_floor": 55,
    "rematch_max": 2,
    "screen_advance_conf": 80,
}

_EARLY_CAREER = ("student", "career_switcher")

_SYSTEM = (
    "You are an HR automation assistant for the Czech tech market. Be concise, specific, fair, and "
    "grounded only in the supplied facts. Write in the requested language. Output strict JSON only."
)


# --- shared LLM-or-fallback helper -----------------------------------------


def _generate(provider: Any | None, prompt: str, deterministic, coerce) -> tuple[dict, str]:
    """Try the LLM; on missing provider OR any error, use the deterministic builder."""
    if provider is None:
        return deterministic(), "deterministic"
    try:
        payload = provider.complete_json(prompt, system=_SYSTEM)
        result = coerce(payload)
        return result, "llm"
    except Exception:
        return deterministic(), "deterministic"


def _str_list(value: Any, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()][:limit]


def _candidate_lang(candidate: MatchCandidate) -> str:
    blob = " ".join(candidate.languages).casefold()
    return "Czech" if ("czech" in blob or "česk" in blob or "cesk" in blob) else "English"


# ============================================================================
# Task 7 — Policy pass (pure deterministic, no LLM)
# ============================================================================


def evaluate_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Decide one entry's automated move. Pure; operates on the entry snapshot.

    entry keys used: stage, archetype, matchScore, daysInStage, approvalKind, recentScreening.
    Returns {action: advance|reject|hold|none, toStage, alerts:[...], reason}.
    """
    stage = entry.get("stage")
    archetype = entry.get("archetype") or "bau"
    score = int(entry.get("matchScore") or 0)
    days = int(entry.get("daysInStage") or 0)
    approval = entry.get("approvalKind")
    recent_screening = bool(entry.get("recentScreening"))
    early = archetype in _EARLY_CAREER

    alerts: list[str] = []
    if days >= POLICY["aging_days"]:
        alerts.append("aging_alert")
    elif days >= POLICY["stale_days"]:
        alerts.append("stale_alert")

    def out(action: str, to_stage: str | None, reason: str) -> dict[str, Any]:
        return {"action": action, "toStage": to_stage, "alerts": alerts, "reason": reason}

    # Never override a screening decision younger than 24h (caller sets recentScreening).
    if recent_screening:
        return out("none", None, "recent screening decision; policy pass skipped")

    if stage == "Sourced":
        # A sourced candidate with a computed match advances into AI-matched, where
        # the archetype-aware screening gate decides. This move is itself fair —
        # archetype-neutral and never a reject — so the fan-out's entries don't
        # stall in Sourced. No score yet → hold until matching has run.
        if score > 0:
            return out("advance", "AI-matched", f"sourced with match score {score} → AI-matched")
        return out("hold", None, "sourced; awaiting match score")
    if stage == "AI-matched":
        if early:
            return out("hold", None, "early-career: human screening gate (never auto-advance/reject)")
        if score >= POLICY["bau_advance_score"]:
            return out("advance", "Screening", f"BAU score {score} ≥ {POLICY['bau_advance_score']}")
        if score < POLICY["bau_reject_score"]:
            return out("reject", None, f"BAU score {score} < {POLICY['bau_reject_score']}")
        return out("hold", None, f"BAU mid score {score} → human review")
    if stage == "Screening":
        if approval:
            return out("hold", None, "approval already pending")
        if days >= POLICY["screening_auto_days"]:
            return out("advance", "Interview", f"in screening {days}d with no pending approval")
        return out("hold", None, "in screening")
    if stage == "Interview":
        return out("hold", None, "Interview → Offer is always a human decision")
    return out("none", None, "no policy for this stage")


# ============================================================================
# Task 1 — AI screening recommendation (LLM + fairness gate + fallback)
# ============================================================================


def screen_candidate(candidate: MatchCandidate, job: Job, m, *, provider: Any | None = None) -> tuple[dict, str]:
    ctx = reasoning_context(candidate, job, m)
    early = candidate.archetype in _EARLY_CAREER
    # PRE-LLM FAIRNESS GATE: a learnable-gap early-career candidate is never auto-rejected.
    forced_hold = early and (candidate.potential_score or 0) > 0.5 and m.total < 55

    prompt = (
        "Screen this candidate for this role. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        + (
            "This is an EARLY-CAREER candidate — judge on potential, frame gaps as learnable, and never "
            "recommend a hard reject; prefer 'hold' for a human.\n"
            if early
            else ""
        )
        + 'Return JSON: { "recommendation": "advance|hold|reject", "confidence": int 0-100, '
        '"rationale": str, "strengths": [str], "redFlags": [str] }. JSON only.'
    )

    def deterministic() -> dict:
        matched = ctx["match"]["matchedSkills"]
        missing = ctx["match"]["missingMustHaves"]
        if forced_hold:
            rec, conf = "hold", 55
        elif m.total >= 70 and not missing:
            rec, conf = "advance", 82
        elif m.total >= 55:
            rec, conf = "hold", 60
        else:
            rec, conf = ("hold" if early else "reject"), 65
        return {
            "recommendation": rec,
            "confidence": conf,
            "rationale": f"Score {m.total}; covers {', '.join(matched[:4]) or 'few skills'}"
            + (f"; missing {', '.join(missing[:3])}" if missing else ""),
            "strengths": matched[:4],
            "redFlags": [f"No evidence of {s}" for s in missing[:3]],
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        rec = str(payload.get("recommendation") or "").strip().lower()
        if rec not in ("advance", "hold", "reject"):
            rec = det["recommendation"]
        try:
            conf = max(0, min(100, int(payload.get("confidence"))))
        except (TypeError, ValueError):
            conf = det["confidence"]
        return {
            "recommendation": rec,
            "confidence": conf,
            "rationale": str(payload.get("rationale") or det["rationale"]),
            "strengths": _str_list(payload.get("strengths")) or det["strengths"],
            "redFlags": _str_list(payload.get("redFlags")),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)

    # Apply the fairness gate + routing AFTER the model/fallback (model cannot override it).
    if forced_hold and result["recommendation"] == "reject":
        result["recommendation"] = "hold"
    if early and result["recommendation"] == "reject":
        result["recommendation"] = "hold"
    advance = result["recommendation"] == "advance" and result["confidence"] >= POLICY["screen_advance_conf"] and not early
    result["route"] = "advance" if advance else "hold"
    result["promptVersion"] = SCREENING_PROMPT_VERSION
    return result, source


# ============================================================================
# Tasks 2–5 — on-demand drafting/synthesis (LLM + fallback)
# ============================================================================


def draft_outreach(candidate: MatchCandidate, job: Job, strengths: list[str], *, provider: Any | None = None):
    lang = _candidate_lang(candidate)
    strong = strengths or candidate.skills[:3]
    prompt = (
        f"Draft a short, warm first-contact outreach message in {lang} inviting this candidate to apply.\n"
        f"Candidate: {candidate.label}; target: {job.title} at {job.company}.\n"
        f"Reference these strengths naturally: {', '.join(strong) or 'their background'}.\n"
        'Return JSON: { "subject": str, "body": str, "language": str }. Keep it concise and non-creepy. JSON only.'
    )

    def deterministic() -> dict:
        if lang == "Czech":
            body = (
                f"Dobrý den {candidate.label},\n\nvšimli jsme si Vašich zkušeností "
                f"({', '.join(strong[:3])}) a rádi bychom Vás oslovili k pozici {job.title} ve společnosti {job.company}. "
                "Pokud Vás to zaujme, ozvěte se nám prosím.\n\nS pozdravem,\nNáborový tým"
            )
            subject = f"{job.title} — máme pro Vás příležitost"
        else:
            body = (
                f"Hi {candidate.label},\n\nyour background in {', '.join(strong[:3])} caught our eye, and we'd love "
                f"to tell you about the {job.title} role at {job.company}. If that sounds interesting, reply and we'll set up a quick chat.\n\nBest,\nThe hiring team"
            )
            subject = f"An opportunity: {job.title}"
        return {"subject": subject, "body": body, "language": lang}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        return {
            "subject": str(payload.get("subject") or det["subject"]),
            "body": str(payload.get("body") or det["body"]),
            "language": str(payload.get("language") or lang),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = OUTREACH_PROMPT_VERSION
    return result, source


def draft_rejection(candidate: MatchCandidate, job: Job, m, stage: str, *, provider: Any | None = None):
    lang = _candidate_lang(candidate)
    missing = m.missing_skills
    prompt = (
        f"Draft a respectful, specific, fair rejection message in {lang} for {candidate.label}, who reached the "
        f"{stage} stage for {job.title} at {job.company}. Optionally include one piece of constructive feedback. "
        "Never disclose other candidates; never use protected-characteristic language.\n"
        'Return JSON: { "subject": str, "body": str, "feedback": str, "language": str }. JSON only.'
    )

    def deterministic() -> dict:
        fb = f"Strengthening {', '.join(missing[:2])}" if missing else "Adding more hands-on project depth"
        if lang == "Czech":
            body = (
                f"Dobrý den {candidate.label},\n\nděkujeme za Váš zájem o pozici {job.title}. "
                "Po pečlivém zvážení jsme se tentokrát rozhodli pokračovat s jinými kandidáty. "
                f"Jako tip do budoucna: {fb}. Přejeme hodně úspěchů.\n\nS pozdravem,\nNáborový tým"
            )
            subject = f"Vaše přihláška — {job.title}"
        else:
            body = (
                f"Hi {candidate.label},\n\nthank you for your interest in the {job.title} role. After careful review "
                f"we've decided to move forward with other candidates this time. One suggestion for the future: {fb}. "
                "We wish you the best.\n\nBest,\nThe hiring team"
            )
            subject = f"Your application — {job.title}"
        return {"subject": subject, "body": body, "feedback": fb, "language": lang}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        return {
            "subject": str(payload.get("subject") or det["subject"]),
            "body": str(payload.get("body") or det["body"]),
            "feedback": str(payload.get("feedback") or det["feedback"]),
            "language": str(payload.get("language") or lang),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = REJECTION_PROMPT_VERSION
    return result, source


def interview_prep(candidate: MatchCandidate, job: Job, m, *, provider: Any | None = None):
    ctx = reasoning_context(candidate, job, m)
    early = candidate.archetype in _EARLY_CAREER
    prompt = (
        "Build an interview prep pack for the INTERVIEWER. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        + (
            "Early-career candidate: probe the depth behind self-declared / project-provenance skills and the gaps.\n"
            if early
            else "Probe depth and the missing must-haves.\n"
        )
        + 'Return JSON: { "questions": [ { "competency": str, "question": str, "whatsGoodLooksLike": str, '
        '"followUpIfAnswer": str } ], "focusAreas": [str] }. 4-6 questions. JSON only.'
    )

    def deterministic() -> dict:
        matched = ctx["match"]["matchedSkills"]
        missing = ctx["match"]["missingMustHaves"]
        qs = []
        for skill in (matched[:2] + missing[:2])[:4]:
            qs.append(
                {
                    "competency": skill,
                    "question": f"Walk me through a concrete time you used {skill}. What was your exact role?",
                    "whatsGoodLooksLike": f"Specific, first-hand detail and trade-offs around {skill}.",
                    "followUpIfAnswer": f"What would you do differently with {skill} next time?",
                }
            )
        if not qs:
            qs.append(
                {
                    "competency": "Project depth",
                    "question": "Walk me through your most significant project end-to-end.",
                    "whatsGoodLooksLike": "Clear ownership, decisions, and outcomes.",
                    "followUpIfAnswer": "What was the hardest trade-off?",
                }
            )
        return {"questions": qs, "focusAreas": missing[:3] or ["depth of recent work"]}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
            return det
        questions = []
        for q in payload["questions"][:6]:
            if not isinstance(q, dict) or not q.get("question"):
                continue
            questions.append(
                {
                    "competency": str(q.get("competency") or "General"),
                    "question": str(q["question"]),
                    "whatsGoodLooksLike": str(q.get("whatsGoodLooksLike") or ""),
                    "followUpIfAnswer": str(q.get("followUpIfAnswer") or ""),
                }
            )
        return {"questions": questions or det["questions"], "focusAreas": _str_list(payload.get("focusAreas")) or det["focusAreas"]}

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = PREP_PROMPT_VERSION
    return result, source


def interview_scorecard(candidate: MatchCandidate, job: Job, notes: str, *, provider: Any | None = None):
    prompt = (
        f"Synthesize a structured interview scorecard for {candidate.label} (role: {job.title}) from these "
        f"interviewer notes:\n\"\"\"{notes[:4000]}\"\"\"\n\n"
        'Return JSON: { "ratings": [ { "competency": str, "rating": int 1-5, "evidence": str } ], '
        '"summary": str, "recommendation": "advance|hold|reject" }. JSON only.'
    )

    def deterministic() -> dict:
        return {
            "ratings": [{"competency": "Overall", "rating": 3, "evidence": (notes[:160] or "No notes provided.")}],
            "summary": "Auto-synthesis unavailable; review the raw notes and rate manually.",
            "recommendation": "hold",
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        ratings = []
        for r in payload.get("ratings") or []:
            if not isinstance(r, dict) or not r.get("competency"):
                continue
            try:
                rating = max(1, min(5, int(r.get("rating"))))
            except (TypeError, ValueError):
                rating = 3
            ratings.append({"competency": str(r["competency"]), "rating": rating, "evidence": str(r.get("evidence") or "")})
        rec = str(payload.get("recommendation") or "").strip().lower()
        if rec not in ("advance", "hold", "reject"):
            rec = "hold"
        return {
            "ratings": ratings or det["ratings"],
            "summary": str(payload.get("summary") or det["summary"]),
            "recommendation": rec,
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = SCORECARD_PROMPT_VERSION
    return result, source


# ============================================================================
# Task 6 — Re-match alternatives (deterministic rank + 1 LLM rationale)
# ============================================================================


def rematch_candidate(
    candidate: MatchCandidate,
    current_job_id: str | None,
    jobs: list[Job],
    *,
    provider: Any | None = None,
) -> dict:
    """Find the best ALTERNATIVE open role for a rejected/idle candidate (top-1, >floor)."""
    scored = []
    for job in jobs:
        if job.id == current_job_id:
            continue
        passed, _reasons = ko_filter(candidate, job)
        if not passed:
            continue
        result = score_job(candidate, job)
        scored.append((result.total, job, result))
    scored.sort(key=lambda x: x[0], reverse=True)

    if not scored or scored[0][0] <= POLICY["rematch_floor"]:
        return {"found": False, "reason": f"no alternative above the {POLICY['rematch_floor']} floor"}

    total, job, result = scored[0]
    reasoning, source = generate_reasoning(candidate, job, result, provider=provider)
    return {
        "found": True,
        "jobId": job.id,
        "jobTitle": job.title,
        "roleFamily": job.role_family,
        "score": total,
        "matchedSkills": result.matched_skills,
        "rationale": reasoning.get("verdict", ""),
        "source": source,
        "promptVersion": REMATCH_PROMPT_VERSION,
    }


# ============================================================================
# Task 8 — Offer package (deterministic salary from the role band + LLM letter)
# ============================================================================

# Fallback bands (CZK/month gross) when a job carries no salary_band.
_SENIORITY_DEFAULT_BAND: dict[str, list[int]] = {
    "junior": [45000, 65000],
    "medior": [65000, 95000],
    "senior": [95000, 140000],
    "lead": [130000, 185000],
}


def _round_k(value: float) -> int:
    return int(round(value / 1000.0)) * 1000


def draft_offer(candidate: MatchCandidate, job: Job, m, *, provider: Any | None = None):
    """Propose a number inside the role's salary band (scaled by fit) + draft the offer letter."""
    band = list(getattr(job, "salary_band", None) or [])
    if len(band) < 2 or band[0] <= 0 or band[1] < band[0]:
        band = _SENIORITY_DEFAULT_BAND.get((job.seniority or "medior").lower(), [65000, 95000])
    lo, hi = int(band[0]), int(band[1])
    currency = "CZK"

    # Position within the band scales with match strength (match 55 -> 10%, 95 -> 90%).
    f = max(0.1, min(0.9, (m.total - 55) / 40.0))
    recommended = max(lo, min(hi, _round_k(lo + (hi - lo) * f)))
    lang = _candidate_lang(candidate)
    rationale = (
        f"Match {m.total}/100 places the offer at ~{int(round(f * 100))}% of the "
        f"{lo:,}–{hi:,} {currency} band for this {job.seniority or 'mid'}-level role."
    )

    prompt = (
        f"Draft a warm, professional job-offer message in {lang} for {candidate.label} for the role "
        f"{job.title} at {job.company}. Gross monthly compensation offered: {recommended:,} {currency}. "
        "Convey genuine enthusiasm, state the figure exactly once, and invite them to discuss. Keep it concise.\n"
        'Return JSON: { "subject": str, "body": str, "language": str }. JSON only.'
    )

    def deterministic() -> dict:
        if lang == "Czech":
            subject = f"Nabídka pozice {job.title} — {job.company}"
            body = (
                f"Dobrý den {candidate.label},\n\nje nám potěšením nabídnout Vám pozici {job.title} ve společnosti "
                f"{job.company}. Navrhovaná hrubá měsíční mzda je {recommended:,} {currency}. Rádi vše osobně probereme "
                "a zodpovíme případné dotazy.\n\nS pozdravem,\nNáborový tým"
            )
        else:
            subject = f"Offer: {job.title} at {job.company}"
            body = (
                f"Hi {candidate.label},\n\nwe're delighted to offer you the {job.title} role at {job.company}. "
                f"The proposed gross monthly compensation is {recommended:,} {currency}. We'd love to walk you through "
                "the details and answer any questions.\n\nBest,\nThe hiring team"
            )
        return {"subject": subject, "body": body, "language": lang}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        return {
            "subject": str(payload.get("subject") or det["subject"]),
            "body": str(payload.get("body") or det["body"]),
            "language": str(payload.get("language") or lang),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result.update(
        {
            "currency": currency,
            "salaryMin": lo,
            "salaryMax": hi,
            "recommended": recommended,
            "rationale": rationale,
            "promptVersion": OFFER_PROMPT_VERSION,
        }
    )
    return result, source
