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
# Letter tasks v2 (backlog #34/#37): explicit --lang (the entry's resolved comms
# locale) overrides the CV-language guess, and the prompts carry the
# gender-neutral style directive; the offer prompt additionally forbids inventing
# a deadline/start date (both are appended deterministically at dispatch).
OUTREACH_PROMPT_VERSION = "outreach-v2"
REJECTION_PROMPT_VERSION = "rejection-v2"
PREP_PROMPT_VERSION = "interview-prep-v1"
# scorecard-v5: the read-back exchange is now emitted as STRUCTURED `entities`
# (confirmed / corrected heard→meant / unconfirmed) alongside the prose trust rule,
# so a recruiter sees that "Rust" in the raw transcript actually meant React — not
# just buried in the summary. Grounded ONLY in an actual read-back; null otherwise.
SCORECARD_PROMPT_VERSION = "scorecard-v5"
REMATCH_PROMPT_VERSION = "rematch-v1"
# offer-v3: the result names its pricing basis — the draft-time fresh fit check
# rides structured as `matchBasis` (rendered under its own label by the approval
# card, REC-01/OO-L2-10) and the rationale prose says "fresh fit check", not a
# bare "Match", so it can't read as the entry's stored match score.
OFFER_PROMPT_VERSION = "offer-v3"

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


def _letter_lang(candidate: MatchCandidate, lang: str | None) -> str:
    """English NAME of the language a candidate-facing letter renders in.

    An explicit locale code from the caller wins — the TS seam passes the entry's
    RESOLVED comms locale (explicit apply choice, else the workspace default), so
    the letter provably matches the deterministic chrome comms-dispatch wraps it
    in (OO-L1-03's two-language-authorities defect). Without one (direct CLI use,
    older callers) fall back to the historical CV-language guess."""
    from .i18n import language_name

    return language_name(lang) if lang else _candidate_lang(candidate)


# Shared style directive for every candidate-facing letter prompt. The OO-L2 run
# caught a live offer letter addressing a woman as 'přesně takového kolegu jsme
# hledali' — instead of guessing gender, the letters avoid gendered forms
# entirely (correct for every candidate, no inference needed).
_NEUTRAL_STYLE = (
    "Use gender-neutral wording about the candidate throughout — never gendered noun/adjective/"
    "participle forms for them (in Czech avoid constructions like 'takového kolegu' / 'takovou "
    "kolegyni' or 'rád/ráda'; prefer direct formal address ('Vy') and neutral phrasing such as "
    "'přesně takovou posilu jsme hledali').\n"
)


def github_evidence_block(github: Any | None) -> str:
    """Render the entry's compact GitHub evidence summary (GH7) as a short
    "Public repo evidence" prompt block for the screen/prep/scorecard tasks.

    ``github`` is the TS-side GithubEvidenceSummary (app/_lib/github-summary.ts)
    parsed from --github-evidence — already validated and clamped at the TS
    boundary, so this only formats. Returns "" when absent or unusable, keeping
    every prompt byte-identical to its pre-GH7 bytes for evidence-less entries."""
    if not isinstance(github, dict):
        return ""
    username = str(github.get("username") or "").strip()
    if not username:
        return ""

    def items(key: str) -> str:
        return ", ".join(_str_list(github.get(key)))

    analyzed = str(github.get("analyzedAt") or "").strip()
    lines = [f"Public repo evidence (GitHub deep-dive of {username}" + (f", analyzed {analyzed}" if analyzed else "") + "):"]
    summary = str(github.get("summary") or "").strip()
    if summary:
        lines.append(f"- Read: {summary}")
    confirmed = items("confirmedSkills")
    if confirmed:
        lines.append(f"- Evidenced skills (public repo signals support these): {confirmed}")
    unverified = items("unverifiedClaims")
    if unverified:
        lines.append(f"- CV claims NOT verified by public repos: {unverified}")
    hidden = items("hiddenStrengths")
    if hidden:
        lines.append(f"- Hidden strengths (visible in repos, absent from the CV): {hidden}")
    return "\n".join(lines) + "\n\n"


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


def screen_candidate(candidate: MatchCandidate, job: Job, m, *, lang: str = "en", provider: Any | None = None, github: Any | None = None) -> tuple[dict, str]:
    from .i18n import language_directive

    ctx = reasoning_context(candidate, job, m)
    early = candidate.archetype in _EARLY_CAREER
    # PRE-LLM FAIRNESS GATE: a learnable-gap early-career candidate is never auto-rejected.
    forced_hold = early and (candidate.potential_score or 0) > 0.5 and m.total < 55

    prompt = (
        "Screen this candidate for this role. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        # GH7 — the persisted deep-dive (corroborated vs unverified JD skills);
        # "" when the entry carries none.
        + github_evidence_block(github)
        + (
            "This is an EARLY-CAREER candidate — judge on potential, frame gaps as learnable, and never "
            "recommend a hard reject; prefer 'hold' for a human.\n"
            if early
            else ""
        )
        + f'Return JSON: {{ "recommendation": "{RECOMMENDATION_CHOICES}", "confidence": int 0-100, '
        '"rationale": str, "strengths": [str], "redFlags": [str] }. JSON only.\n'
        # rationale / strengths / redFlags are the recruiter-facing screening prose
        # (surfaced in Decisions); generate them in the requested language while the
        # recommendation code value stays verbatim. Deterministic fallback below
        # stays English.
        + language_directive(lang)
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


def draft_outreach(candidate: MatchCandidate, job: Job, strengths: list[str], *, lang: str | None = None, provider: Any | None = None):
    lang = _letter_lang(candidate, lang)
    strong = strengths or candidate.skills[:3]
    prompt = (
        f"Draft a short, warm first-contact outreach message in {lang} inviting this candidate to apply.\n"
        f"Candidate: {candidate.label}; target: {job.title} at {job.company}.\n"
        f"Reference these strengths naturally: {', '.join(strong) or 'their background'}.\n"
        + _NEUTRAL_STYLE
        + 'Return JSON: { "subject": str, "body": str, "language": str }. Keep it concise and non-creepy. JSON only.'
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


def draft_rejection(candidate: MatchCandidate, job: Job, m, stage: str, *, lang: str | None = None, provider: Any | None = None):
    lang = _letter_lang(candidate, lang)
    missing = m.missing_skills
    prompt = (
        f"Draft a respectful, specific, fair rejection message in {lang} for {candidate.label}, who reached the "
        f"{stage} stage for {job.title} at {job.company}. Optionally include one piece of constructive feedback. "
        "Never disclose other candidates; never use protected-characteristic language.\n"
        + _NEUTRAL_STYLE
        + 'Return JSON: { "subject": str, "body": str, "feedback": str, "language": str }. JSON only.'
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


def interview_prep(candidate: MatchCandidate, job: Job, m, *, lang: str = "en", provider: Any | None = None, github: Any | None = None):
    from .i18n import language_directive

    ctx = reasoning_context(candidate, job, m)
    early = candidate.archetype in _EARLY_CAREER
    prompt = (
        "Build an interview prep pack for the INTERVIEWER. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        # GH7 — repo evidence sharpens the probes (verify the unverified claims).
        + github_evidence_block(github)
        + (
            "Early-career candidate: probe the depth behind self-declared / project-provenance skills and the gaps.\n"
            if early
            else "Probe depth and the missing must-haves.\n"
        )
        + 'Return JSON: { "questions": [ { "competency": str, "question": str, "whatsGoodLooksLike": str, '
        '"followUpIfAnswer": str } ], "focusAreas": [str] }. 4-6 questions. JSON only.\n'
        # PREP2 — questions/whatsGoodLooksLike/followUp + focusAreas are the
        # interviewer's free-form prep prose; generate them in the requested
        # language (the deterministic fallback below stays English).
        + language_directive(lang)
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
# P2-3 — industry-relevant EXTRA axes keyed by role-family, APPENDED to the base
# rubric so a nurse is scored on clinical judgment, a tradesperson on safety, etc.
# Mirrors the TS INDUSTRY_AXES (same JSON). Additive: an unmapped family adds none.
INDUSTRY_AXES: dict[str, list[dict]] = _RUBRIC_DATA.get("industryAxes", {})


def scoring_model_for_archetype(archetype: str | None) -> str:
    """The rubric / scoring model for an archetype: 'early_career' for early-career
    archetypes (registry scoringModel), else 'experienced' — including unknown/None,
    matching the scorecard's experienced default."""
    return "early_career" if (archetype or "").strip().lower() in _EARLY_CAREER else "experienced"


def rubric_for_archetype(archetype: str | None) -> list[dict]:
    """The base scorecard rubric for a candidate's archetype. Early-career
    archetypes get the potential / mental-model BARS rubric; everyone else the
    experienced rubric. Mirrors the TS `rubricForArchetype` base; both resolve the
    split from the shared archetypes.json."""
    return INTERVIEW_RUBRICS.get(scoring_model_for_archetype(archetype), INTERVIEW_RUBRICS["experienced"])


def industry_axes_for(role_family: str | None) -> list[dict]:
    """The industry EXTRA axes for a role-family (empty for an unknown/blank one).
    Mirrors the TS `industryAxesFor`; both read the shared rubric JSON."""
    return INDUSTRY_AXES.get((role_family or "").strip(), [])


def rubric_for_candidate(archetype: str | None, role_family: str | None) -> list[dict]:
    """The full rubric scored for a candidate: the base (scoringModel) rubric PLUS
    any industry axes for their role-family (P2-3), appended. Mirrors the TS
    `rubricForArchetype(archetype, roleFamily)`."""
    return [*rubric_for_archetype(archetype), *industry_axes_for(role_family)]


def rubric_version_hash(rubric: list[dict]) -> str:
    """A stable content hash of a resolved rubric slice — the "rubric version" a
    scorecard stamps at write time so it can be re-evaluated against the exact scale
    it was scored on, even after interview-rubrics.json revises (Direction 2).

    Byte-identical to the TS `rubricVersionHash` (interview-rubric.ts): a delimiter-
    joined canonical string (NOT JSON, so no cross-language canonicalization risk)
    hashed with 64-bit FNV-1a over its UTF-8 bytes. Covers competency + description +
    BARS anchors, so a reworded anchor advances the version. A cross-side parity test
    (test_interview_rubrics.py + interview-rubric.test.ts) pins both to one literal."""
    US = "␟"  # unit separator (competency fields)
    RS = "␞"  # record separator (between competencies)
    parts = []
    for c in rubric:
        anchors = c.get("anchors")
        anchors_canon = (
            US.join(f"{k}={anchors[k]}" for k in sorted(anchors, key=int)) if anchors else ""
        )
        parts.append(US.join([c["competency"], c["description"], anchors_canon]))
    canon = RS.join(parts)
    mask = 0xFFFFFFFFFFFFFFFF
    h = 0xCBF29CE484222325  # FNV-1a 64-bit offset basis
    for b in canon.encode("utf-8"):
        h ^= b
        h = (h * 0x100000001B3) & mask
    return format(h, "016x")


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


def _coerce_entities(raw: Any) -> dict | None:
    """Narrow the model's `entities` blob to the structured read-back record, or None
    when there was no read-back to show. Grounded, defensive parsing (mirrors the
    per-rating clamp): a non-dict, a missing field, or empty/malformed buckets never
    fabricate an exchange. Returns None when EVERY bucket is empty so the key is
    omitted and absence stays the honest "no read-back happened" signal — never an
    invented one."""
    if not isinstance(raw, dict):
        return None

    def _strs(v: Any) -> list[str]:
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for x in v:
            s = x.strip() if isinstance(x, str) else ""
            if s:
                out.append(s)
        return out

    confirmed_raw = _strs(raw.get("confirmed"))
    unconfirmed_raw = _strs(raw.get("unconfirmed"))
    corrected: list[dict] = []
    for c in raw.get("corrected") or []:
        if not isinstance(c, dict):
            continue
        heard = c.get("heard").strip() if isinstance(c.get("heard"), str) else ""
        meant = c.get("meant").strip() if isinstance(c.get("meant"), str) else ""
        if heard and meant:
            corrected.append({"heard": heard, "meant": meant})
    # Cross-bucket dedupe with a documented precedence so a token the model emits in
    # more than one bucket renders in exactly ONE list. Precedence (highest first):
    #   corrected.meant ("what they actually meant") > confirmed > unconfirmed.
    # A token present in a higher bucket is dropped from every lower one — exact,
    # trimmed string match, order preserved. Mirrors normalizeScorecardEntities (TS).
    meant_set = {c["meant"] for c in corrected}
    confirmed = [t for t in confirmed_raw if t not in meant_set]
    confirmed_set = set(confirmed)
    unconfirmed = [t for t in unconfirmed_raw if t not in meant_set and t not in confirmed_set]
    if not confirmed and not corrected and not unconfirmed:
        return None
    return {"confirmed": confirmed, "corrected": corrected, "unconfirmed": unconfirmed}


def interview_scorecard(candidate: MatchCandidate, job: Job, notes: str, *, lang: str = "en", provider: Any | None = None, github: Any | None = None):
    from .i18n import language_directive

    # `model` is the base scoring model (experienced / early_career) — still the
    # value reported as result["scoringModel"] and used by the compare grid for
    # grouping. The scored rubric is that base PLUS any industry axes for the
    # candidate's role-family (P2-3): a nurse is also scored on clinical judgment,
    # a tradesperson on safety. Additive — an unmapped family leaves the prompt
    # exactly as it was pre-P2-3.
    model = scoring_model_for_archetype(candidate.archetype)
    rubric = rubric_for_candidate(candidate.archetype, candidate.role_family)
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
        # GH7 — repo evidence contextualizes the ratings (e.g. a thin transcript
        # answer on a skill the repos already corroborate); "" when absent, so
        # the evidence-less prompt stays byte-identical (same guarantee as the
        # BARS-anchor fallback below).
        + github_evidence_block(github)
        + "Rate the candidate on EACH of these fixed competencies (do NOT invent or omit any):\n"
        f"{rubric_lines}\n"
        f"Rating scale: {anchors}.\n"
        "Ground every rating in the transcript: the evidence MUST be a short, near-verbatim quote of the "
        "candidate's own words that justifies the score — do not paraphrase or invent. If the transcript "
        "does not cover a competency, set its evidence to an empty string and rate it 3 (not assessed).\n"
        # Read-back trust rule (docs/INTERVIEW_IMPROVEMENT_INPUTS.md §2/§5): the brief now has the
        # agent read back the technologies it heard before closing; that confirmation turn — not the
        # raw ASR earlier in the call — is the authoritative record of the candidate's stack.
        "The transcript comes from voice recognition, which can corrupt technology and product names "
        "(e.g. React heard as Rust, PostgreSQL heard as 'později SQL'). If the interviewer read back a "
        "list of technologies near the end and the candidate confirmed or corrected it, treat that "
        "confirmation/correction as the AUTHORITATIVE record of the candidate's technologies — where it "
        "conflicts with an earlier mention, the confirmation wins. Do not credit a specific technology "
        "that appears only in earlier, unconfirmed turns as an established skill: note it in the summary "
        "as unconfirmed (possible transcription error) rather than asserting it.\n"
        # scorecard-v5: emit that read-back as STRUCTURED data so the recruiter gets a cue, not just prose.
        'If — and ONLY if — such a read-back exchange actually happened in the transcript, also return an '
        '"entities" object capturing its outcome: "confirmed" = technologies the candidate confirmed as heard; '
        '"corrected" = each mishearing the candidate fixed, as {"heard": what the transcript recorded, '
        '"meant": what the candidate said it should be}; "unconfirmed" = technologies mentioned only in earlier, '
        'unconfirmed turns and never reached in the read-back (possible transcription errors). If NO read-back '
        'exchange occurred, set "entities" to null — never invent one.\n'
        'Return JSON: { "ratings": [ { "competency": str (exactly one of the above), "rating": int 1-5, '
        '"evidence": str (verbatim candidate quote, or "") } ], "summary": str, '
        f'"recommendation": "{RECOMMENDATION_CHOICES}", '
        '"entities": { "confirmed": [str], "corrected": [{"heard": str, "meant": str}], "unconfirmed": [str] } | null }. '
        "Include every competency, in the order listed. JSON only.\n"
        # summary + the recommendation rationale are recruiter-facing prose;
        # generate them in the requested language. The per-competency `evidence`
        # stays a verbatim candidate quote and the competency + recommendation code
        # values stay verbatim. Deterministic fallback below stays English.
        + language_directive(lang)
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
        out = {
            "ratings": ratings,
            "summary": str(payload.get("summary") or det["summary"]),
            "recommendation": rec,
        }
        # scorecard-v5 — the structured read-back outcome. Attached ONLY when the model
        # returned a well-formed, non-empty exchange; a null/absent/all-empty `entities`
        # (no read-back happened) leaves the key off entirely, so consumers treat its
        # absence as "no read-back" and render no chrome (mirrors the coverage rule).
        entities = _coerce_entities(payload.get("entities"))
        if entities is not None:
            out["entities"] = entities
        return out

    result, source = _generate(provider, prompt, deterministic, coerce)
    # Self-describe which rubric this was scored on (the compare grid renders the
    # matching axes per cohort) and how far to trust it given the transcript.
    result["scoringModel"] = model
    result["confidence"] = _scorecard_confidence(notes, result.get("ratings") or [], len(rubric))
    result["promptVersion"] = SCORECARD_PROMPT_VERSION
    # Direction 2 — stamp the rubric this scorecard was scored against (version hash +
    # its competency keys) so it can be re-evaluated on the exact scale later, after
    # interview-rubrics.json revises. Same shape the human scorecard POST stamps; the
    # hash is byte-identical to the TS side (rubric_version_hash mirrors rubricVersionHash).
    result["rubricVersion"] = rubric_version_hash(rubric)
    result["rubricKeys"] = [c["competency"] for c in rubric]
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


def draft_offer(candidate: MatchCandidate, job: Job, m, *, lang: str | None = None, provider: Any | None = None):
    """Propose a number inside the role's salary band (scaled by fit) + draft the offer letter."""
    band = list(getattr(job, "salary_band", None) or [])
    if len(band) < 2 or band[0] <= 0 or band[1] < band[0]:
        band = _SENIORITY_DEFAULT_BAND.get((job.seniority or "medior").lower(), [65000, 95000])
    lo, hi = int(band[0]), int(band[1])
    currency = "CZK"

    # Position within the band scales with match strength (match 55 -> 10%, 95 -> 90%).
    f = max(0.1, min(0.9, (m.total - 55) / 40.0))
    recommended = max(lo, min(hi, _round_k(lo + (hi - lo) * f)))
    lang = _letter_lang(candidate, lang)
    # Name the producer (REC-01/OO-L2-10): this number is a FRESH fit check run at
    # draft time — NOT the entry's stored match score the approval-card header
    # shows — so the prose must never read as bare "Match N/100".
    rationale = (
        f"Fresh fit check {m.total}/100 at offer draft places the offer at ~{int(round(f * 100))}% of the "
        f"{lo:,}–{hi:,} {currency} band for this {job.seniority or 'mid'}-level role."
    )

    prompt = (
        f"Draft a warm, professional job-offer message in {lang} for {candidate.label} for the role "
        f"{job.title} at {job.company}. Gross monthly compensation offered: {recommended:,} {currency}. "
        "Convey genuine enthusiasm, state the figure exactly once, and invite them to discuss. Keep it concise.\n"
        + _NEUTRAL_STYLE
        # OO-L1-04 — the response deadline is a per-offer lever chosen at approval
        # time and the start date is agreed later; both are APPENDED to the letter
        # deterministically at dispatch (comms-dispatch.dispatchOffer). A drafted
        # guess here could only contradict the real terms.
        + "Do not state a response deadline, expiry, or start date — the delivery system appends the "
        "offer's actual deadline (and start date when known) below the letter.\n"
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
            # The draft-time fit total that priced this offer, structured, so the
            # approval card can label it ("fresh fit check at draft: N/100")
            # instead of parsing it out of English prose (REC-01/OO-L2-10).
            "matchBasis": m.total,
            "promptVersion": OFFER_PROMPT_VERSION,
        }
    )
    return result, source
