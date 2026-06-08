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
from pathlib import Path
from typing import Any

from . import registry
from .jobs import Job
from .matching import MatchCandidate, ko_filter, score_job
from .match_reasoning import generate as generate_reasoning
from .match_reasoning import reasoning_context

SCREENING_PROMPT_VERSION = "screening-v1"
OUTREACH_PROMPT_VERSION = "outreach-v1"
REJECTION_PROMPT_VERSION = "rejection-v1"
PREP_PROMPT_VERSION = "interview-prep-v1"
SCORECARD_PROMPT_VERSION = "scorecard-v3"
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

# Single-sourced from the shared registry (archetypes.json) so the in-code fairness
# levers (never auto-advance/reject early-career) can't drift from the scorer's set.
_EARLY_CAREER = registry.early_career_archetypes()

# The interview / screening VERDICT contract — the canonical advance|hold|reject
# vocabulary every LLM HR task emits and the whole pipeline branches on. Defined
# ONCE here (previously an inline literal repeated in each prompt + a duplicated
# coerce tuple) and mirrored on the TS side in
# app/_lib/interview-recommendation.ts; the cross-language contract + fallback are
# documented in docs/AUTOMATION_SPEC.md §2.5.
RECOMMENDATIONS: tuple[str, ...] = ("advance", "hold", "reject")
# Fallback for an unknown / empty / malformed verdict: the safe middle state.
# Never silently `advance` (could auto-progress a candidate) or `reject` (the
# fairness gate forbids a silent auto-reject) — `hold` routes to the human
# Decisions gate. Mirrors INTERVIEW_RECOMMENDATION_FALLBACK on the TS side.
RECOMMENDATION_FALLBACK = "hold"
# Rendered into the prompts as "advance|hold|reject"; derived so the legal set is
# stated in exactly one place and the prompt can never list a stale vocabulary.
RECOMMENDATION_CHOICES = "|".join(RECOMMENDATIONS)
# The screen-route gate: a strict SUBSET of the verdicts. screen_candidate()
# collapses (recommendation, confidence, fairness gate) into result["route"] ∈
# this set, which the TS layer reads to auto-advance vs. queue for review.
# Mirrors SCREEN_ROUTES on the TS side.
SCREEN_ROUTES: tuple[str, ...] = ("advance", "hold")

_SYSTEM = (
    "You are an HR automation assistant for the Czech tech market. Be concise, specific, fair, and "
    "grounded only in the supplied facts. Write in the requested language. Output strict JSON only."
)


def coerce_recommendation(value: Any, default: str = RECOMMENDATION_FALLBACK) -> str:
    """Validate a raw verdict against the canonical {advance, hold, reject} set.

    Trims + lower-cases, then returns the member if recognised, else ``default``
    (``RECOMMENDATION_FALLBACK`` = "hold" unless a caller supplies a context-aware
    fallback such as the deterministic builder's own verdict). The single guard
    both LLM-task coercers use, so the legal set lives in one place."""
    rec = str(value or "").strip().lower()
    return rec if rec in RECOMMENDATIONS else default


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

    An absent/null matchScore (matching not yet run, or a data gap) is treated as
    "unscored" — distinct from a genuine low score — and never auto-rejects: it
    holds for matching, mirroring the Accepted-stage gate. Without this, an
    unscored entry would collapse to ``int(None or 0) == 0`` and be rejected for
    ``0 < bau_reject_score``, silently turning a data gap into a rejection.
    """
    stage = entry.get("stage")
    archetype = entry.get("archetype") or "bau"
    score = int(entry.get("matchScore") or 0)
    # `score == 0` means matching hasn't produced a real result yet (None, absent,
    # or a literal 0 placeholder) — an unscored entry, not a genuine zero match.
    scored = score > 0
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

    # Never override a screening decision still inside the override-guard window. The window
    # itself lives in TS as SCREENING_OVERRIDE_GUARD_HOURS (24h) in app/_lib/db.ts
    # (listActiveEntriesForAutomation) — the single source of truth; Python only receives the
    # opaque `recentScreening` boolean, so that constant is the checkable definition of "recent".
    if recent_screening:
        return out("none", None, "recent screening decision; policy pass skipped")

    if stage == "Accepted":
        # CV received (inbound application or proactively sourced), waiting for
        # screening. Once a match score exists it has cleared first-wave matching →
        # advance into Screened, where the archetype-aware gate decides. This move is
        # fair — archetype-neutral and never a reject — so intake doesn't stall in
        # Accepted. No score yet → hold until matching has run.
        if scored:
            return out("advance", "Screened", f"received with match score {score} → Screened")
        return out("hold", None, "accepted; awaiting match score")
    if stage == "Screened":
        # First wave of evaluation (matching + AI screening), collapsed into one
        # stage. Early-career is NEVER auto-advanced/rejected (human screening gate);
        # a pending approval holds; weak BAU is screened out; strong BAU clears
        # screening and advances to Interview once it has settled; mid → human.
        if approval:
            return out("hold", None, "approval already pending")
        if early:
            return out("hold", None, "early-career: human screening gate (never auto-advance/reject)")
        if not scored:
            # No match score yet (matching not run, or a data gap). Hold for matching
            # rather than reading the missing score as 0 and auto-rejecting it.
            return out("hold", None, "screened without a match score; awaiting match (not auto-rejected)")
        if score < POLICY["bau_reject_score"]:
            return out("reject", None, f"BAU score {score} < {POLICY['bau_reject_score']}")
        if score >= POLICY["bau_advance_score"]:
            if days >= POLICY["screening_auto_days"]:
                return out("advance", "Interview", f"BAU score {score} cleared screening, {days}d in Screened → Interview")
            return out("hold", None, f"BAU score {score} cleared screening; settling in Screened")
        return out("hold", None, f"BAU mid score {score} → human review")
    if stage == "Interview":
        return out("hold", None, "Interview → Offer is always a human decision")
    if stage == "Offer":
        # Extending the offer is the recruiter's call; the Offer → Hired move is the
        # candidate's (captured via their accept/decline link). Policy never advances
        # or rejects an offer — it only surfaces aging so a stale offer gets a nudge.
        return out("hold", None, "Offer is a human + candidate decision; awaiting response")
    if stage == "Hired":
        return out("none", None, "hired — terminal stage")
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
        + f'Return JSON: {{ "recommendation": "{RECOMMENDATION_CHOICES}", "confidence": int 0-100, '
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
        # Off-set / missing verdict falls back to the deterministic builder's own
        # (context-aware) recommendation rather than a blind "hold".
        rec = coerce_recommendation(payload.get("recommendation"), det["recommendation"])
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


# Scorecard rubrics — the SAME competency axes for every candidate of a given
# archetype, so interviews stay structured and directly comparable WITHIN a
# cohort (Greenhouse/HireVue-style). The rubrics live in ONE place,
# interview-rubrics.json, read directly here AND by the recruiter compare grid
# (app/_lib/interview-rubric.ts) — same single-source pattern as archetypes.json,
# so the TS<->Python drift a hand-mirror would risk is structurally impossible.
#
# Rubrics are keyed by the archetype's `scoringModel`: `experienced` keeps the
# historical generic axes (track-record based); `early_career` re-gears them for
# zero-/low-experience candidates, scoring mental model and potential with full
# behaviorally-anchored (BARS) descriptors per level rather than years of work.
_RUBRIC_DATA: dict[str, Any] = json.loads(
    Path(__file__).with_name("interview-rubrics.json").read_text(encoding="utf-8")
)
# Generic 1-5 scale, shared across rubrics. Keys coerced to int for the existing
# {int: str} contract (the TS mirror and compare grid read the same JSON).
RATING_ANCHORS = {int(k): v for k, v in _RUBRIC_DATA["ratingAnchors"].items()}
INTERVIEW_RUBRICS: dict[str, list[dict]] = _RUBRIC_DATA["rubrics"]
# Backwards-compatible alias: the historical flat rubric IS the experienced one.
INTERVIEW_RUBRIC = INTERVIEW_RUBRICS["experienced"]


def scoring_model_for_archetype(archetype: str | None) -> str:
    """The rubric / scoring model for an archetype: 'early_career' for early-career
    archetypes (registry scoringModel), else 'experienced' — including unknown/None,
    matching the scorecard's experienced default."""
    return "early_career" if (archetype or "").strip().lower() in _EARLY_CAREER else "experienced"


def rubric_for_archetype(archetype: str | None) -> list[dict]:
    """The scorecard rubric for a candidate's archetype. Early-career archetypes
    get the potential / mental-model BARS rubric; everyone else the experienced
    rubric. Mirrors the TS `rubricForArchetype`; both resolve the split from the
    shared archetypes.json."""
    return INTERVIEW_RUBRICS.get(scoring_model_for_archetype(archetype), INTERVIEW_RUBRICS["experienced"])


def _scorecard_confidence(notes: str, ratings: list[dict], total: int) -> dict:
    """Deterministic confidence in the scorecard, driven by how much the transcript
    actually supports. A short or thinly-evidenced interview yields a WIDE band
    (treat the ratings as provisional) rather than a low score — so a brief or
    nervous candidate is not penalised on substance. Mirrors the intent of the
    match confidence band: separate the signal from how sure we are of it."""
    n = len(notes or "")
    assessed = sum(
        1
        for r in ratings
        if (r.get("evidence") or "").strip() and not str(r.get("evidence")).startswith("Not assessed")
    )
    if n < 600 or assessed * 2 < total:
        return {"level": "wide", "reason": "Thin transcript or few competencies evidenced — treat ratings as provisional."}
    if n >= 2000 and assessed >= total:
        return {"level": "tight", "reason": "Full-length transcript with every competency evidenced."}
    return {"level": "moderate", "reason": "Partial evidence across the competencies."}


def interview_scorecard(candidate: MatchCandidate, job: Job, notes: str, *, provider: Any | None = None):
    model = scoring_model_for_archetype(candidate.archetype)
    rubric = INTERVIEW_RUBRICS.get(model, INTERVIEW_RUBRICS["experienced"])
    anchors = ", ".join(f"{k}={v}" for k, v in RATING_ANCHORS.items())

    def _rubric_line(competency: dict) -> str:
        line = f"- {competency['competency']}: {competency['description']}"
        bars = competency.get("anchors")
        if bars:
            # Per-competency behavioral anchors (BARS) — give the model the
            # concrete bar for each level so early-career ratings are calibrated,
            # not vibes. Experienced competencies carry none and fall back to the
            # generic scale above, leaving that prompt byte-identical.
            scale = "; ".join(f"{level}={bars[level]}" for level in sorted(bars, key=int))
            line += f"\n    Level anchors — {scale}"
        return line

    rubric_lines = "\n".join(_rubric_line(c) for c in rubric)
    prompt = (
        f"Synthesize a structured interview scorecard for {candidate.label} (role: {job.title}) from these "
        f"interviewer notes / transcript:\n\"\"\"{notes[:4000]}\"\"\"\n\n"
        "Rate the candidate on EACH of these fixed competencies (do NOT invent or omit any):\n"
        f"{rubric_lines}\n"
        f"Rating scale: {anchors}.\n"
        "Ground every rating in the transcript: the evidence MUST be a short, near-verbatim quote of the "
        "candidate's own words that justifies the score — do not paraphrase or invent. If the transcript "
        "does not cover a competency, set its evidence to an empty string and rate it 3 (not assessed).\n"
        'Return JSON: { "ratings": [ { "competency": str (exactly one of the above), "rating": int 1-5, '
        '"evidence": str (verbatim candidate quote, or "") } ], "summary": str, '
        f'"recommendation": "{RECOMMENDATION_CHOICES}" }}. '
        "Include every competency, in the order listed. JSON only."
    )

    def deterministic() -> dict:
        snippet = (notes[:140].strip() or "No interviewer notes provided.")
        return {
            "ratings": [
                {"competency": c["competency"], "rating": 3, "evidence": "Not assessed (auto-synthesis unavailable)."}
                for c in rubric
            ],
            "summary": "Auto-synthesis unavailable; review the transcript and rate against the rubric manually. " + snippet,
            "recommendation": "hold",
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det

        # Match competencies leniently so a model that returns "Problem solving"
        # (space) or "Technical Depth" (case) still maps onto the fixed rubric
        # rather than being dropped and defaulting that axis to "Not assessed".
        def norm(s: Any) -> str:
            return "".join(ch for ch in str(s).lower() if ch.isalnum())

        by_comp: dict[str, dict] = {}
        for r in payload.get("ratings") or []:
            if not isinstance(r, dict) or not r.get("competency"):
                continue
            try:
                rating = max(1, min(5, int(r.get("rating"))))
            except (TypeError, ValueError):
                rating = 3
            by_comp[norm(r["competency"])] = {"rating": rating, "evidence": str(r.get("evidence") or "")}
        # Always emit every rubric competency, in rubric order, filling gaps.
        ratings = []
        for c in rubric:
            got = by_comp.get(norm(c["competency"]))
            ratings.append(
                {
                    "competency": c["competency"],
                    "rating": got["rating"] if got else 3,
                    "evidence": (got["evidence"] if got else "") or "Not assessed.",
                }
            )
        rec = coerce_recommendation(payload.get("recommendation"))
        return {
            "ratings": ratings,
            "summary": str(payload.get("summary") or det["summary"]),
            "recommendation": rec,
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    # Self-describe which rubric this was scored on (the compare grid renders the
    # matching axes per cohort) and how far to trust it given the transcript.
    result["scoringModel"] = model
    result["confidence"] = _scorecard_confidence(notes, result.get("ratings") or [], len(rubric))
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
    """Find the best ALTERNATIVE open role for a candidate (top-1, >floor).

    Pure ranking — this proposes the alternative; it does NOT touch pipeline state.
    What rematch does to the SOURCE entry (close the current entry so the candidate
    is never live in two automatable funnels at once, and link source→target) is the
    TS layer's contract, enforced once in `rematchSourceEntry` (app/_lib/db.ts) and
    applied by the rematch branch of `runAutomationTask` — idea-9ad8a777. Historically
    framed as "for a rejected/idle candidate"; that re-engagement case is now one
    branch of that contract (an already-terminal source is linked but left closed).
    """
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
