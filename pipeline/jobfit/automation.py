"""LLM-driven HR automation for the hiring pipeline (Direction 2).

Local-first: the ONLY runtime LLM engine is the Claude Code CLI via
ClaudeCliProvider. Every LLM task ships a deterministic fallback (mirroring
match_reasoning.generate) so the pipeline never blocks when the CLI is absent
(provider=None => deterministic path). Task 7 (policy pass) is pure-deterministic.

Fairness is enforced in code, not left to the model: early-career candidates
(student / career_switcher) are never silently advanced or rejected by automation.

See docs/features/pipeline/README.md for the full design.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import registry
from .jobs import Job
from .market_config import ACTIVE_MARKET, MarketConfig, gross_period_phrase
from .matching import MatchCandidate, ko_filter, score_job
from .match_reasoning import generate as generate_reasoning
from .match_reasoning import reasoning_context

# screening-v2: no prompt-content change — the version marks the CACHE-AXIS
# correction. The screening rationale is generated in the requested --lang, but the
# TS cache key ignored the locale, so a locale switch served the previous language's
# rationale for the full 168h TTL. Bumped in lockstep with AUTOMATION_VERSION.screen
# (app/_lib/automation-run.ts) so the wrongly-shared v1 entries self-invalidate.
SCREENING_PROMPT_VERSION = "screening-v2"
# Letter tasks v2 (backlog #34/#37): explicit --lang (the entry's resolved comms
# locale) overrides the CV-language guess, and the prompts carry the
# gender-neutral style directive; the offer prompt additionally forbids inventing
# a deadline/start date (both are appended deterministically at dispatch).
# v3 (offer v4) — 2026-08-11 bench round: the letters now receive the shared
# _letter_context evidence (highlights, aspirations, match, job facts — they were
# starved to a name + skill tags, so no model could personalize), anchor on the
# strongest candidate-specific hooks under _LETTER_GROUNDING, the rejection names
# the actual decisive gap + evidence-checked feedback, and _NEUTRAL_STYLE demands
# grammatical neutrality by RECAST (no plural-for-one, no slash forms, no
# mixed-script output).
OUTREACH_PROMPT_VERSION = "outreach-v3"
REJECTION_PROMPT_VERSION = "rejection-v3"
PREP_PROMPT_VERSION = "interview-prep-v2"
# scorecard-v5: the read-back exchange is now emitted as STRUCTURED `entities`
# (confirmed / corrected heard→meant / unconfirmed) alongside the prose trust rule,
# so a recruiter sees that "Rust" in the raw transcript actually meant React — not
# just buried in the summary. Grounded ONLY in an actual read-back; null otherwise.
# scorecard-v6: no prompt-content change over v5 — same cache-axis correction as
# screening-v2 (the summary is generated in the requested --lang, which is now a
# key axis). Kept in lockstep with AUTOMATION_VERSION.scorecard.
SCORECARD_PROMPT_VERSION = "scorecard-v6"
REMATCH_PROMPT_VERSION = "rematch-v1"
# offer-v3: the result names its pricing basis — the draft-time fresh fit check
# rides structured as `matchBasis` (rendered under its own label by the approval
# card, REC-01/OO-L2-10) and the rationale prose says "fresh fit check", not a
# bare "Match", so it can't read as the entry's stored match score.
OFFER_PROMPT_VERSION = "offer-v4"

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
# documented in docs/features/pipeline/README.md §2.5.
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

def _system_prompt(market: MarketConfig = ACTIVE_MARKET) -> str:
    """The HR-automation system persona, with the target market named from config
    instead of a hardcoded "Czech" — the last automation reasoning persona still
    biased Czech after campaign.py (round 9) and group_compare.py (round 10) were
    de-Czech'd. For the Czech default (descriptor "Czech") this is byte-identical to
    the "_SYSTEM" literal it replaced, so every screening/letter task is unchanged for
    the pilot; a re-homed market tells the model the RIGHT market on every task."""
    market_phrase = market.market_descriptor or ACTIVE_MARKET.market_descriptor
    return (
        f"You are an HR automation assistant for the {market_phrase} tech market. Be concise, specific, fair, and "
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
    """Try the LLM; on missing provider OR any error, use the deterministic builder.

    Truthful source: when coercion discards the model's payload entirely, the
    result is byte-identical to the deterministic template — report THAT as
    ``deterministic`` (the tokens were spent, but the answer on the wire is not
    the model's). The 2026-08-11 bench caught a template-for-template payload
    graded as the model's work; same honesty rule as match_reasoning._coerce."""
    if provider is None:
        return deterministic(), "deterministic"
    try:
        payload = provider.complete_json(prompt, system=_system_prompt())
        result = coerce(payload)
        return result, ("deterministic" if result == deterministic() else "llm")
    except Exception:
        return deterministic(), "deterministic"


def _str_list(value: Any, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()][:limit]


# Candidate-DECLARED language name -> app locale code, for the best-effort letter
# language guess when no explicit comms locale is supplied. Only the app LOCALES
# (en/cs/de/fr — the set i18n.LANG_NAMES models) are resolvable; any other declared
# language is not a locale we can write in and is ignored (English stays the
# fallback). Diacritic-free spellings are included so an ASCII-folded CV ("cesky",
# "francais", "nemcina") still resolves. This is the only place a *free-text* language
# name is mapped to a locale; an explicit --lang code goes through normalize_lang.
_DECLARED_LANG_TO_LOCALE: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("cs", ("czech", "česk", "češ", "cesk", "ceš", "cest")),
    ("de", ("german", "deutsch", "němč", "nemc")),
    ("fr", ("french", "français", "francais")),
    ("en", ("english", "anglič", "anglic")),
)


def _candidate_lang(candidate: MatchCandidate, *, market: MarketConfig = ACTIVE_MARKET) -> str:
    """Best-effort English NAME of the language a candidate-facing letter should
    render in, guessed from the candidate's DECLARED spoken languages
    (``candidate.languages``) when no explicit comms locale is supplied.

    Extended from the original hardcoded Czech/English binary to the full app LOCALE
    set (en/cs/de/fr) via i18n's ``LANG_NAMES`` — so a candidate who lists only German
    or French no longer silently collapses to an English letter.

    LIMITATION — honest by design: ``candidate.languages`` lists what the person
    SPEAKS, not their preferred correspondence locale, so a multilingual candidate is
    inherently ambiguous. The reliable signal is an explicit locale field, which
    :func:`_letter_lang` prefers over this guess (the TS seam passes the entry's
    resolved comms locale in real flows); this function is only the fallback for direct
    CLI / older callers. To stay conservative we resolve by priority: the active
    market's home language wins when the candidate declares it (a Czech-market Czech
    speaker → Czech), else English when declared (the lingua-franca tiebreak, so a
    "German, English" speaker still gets English exactly as before), else the first
    declared app locale, else English. This keeps every cs/en outcome byte-identical
    and only ADDS detection for candidates who speak neither Czech nor English."""
    from .i18n import DEFAULT_LANG, language_name

    blob = " ".join(candidate.languages).casefold()
    declared = [code for code, aliases in _DECLARED_LANG_TO_LOCALE if any(a in blob for a in aliases)]
    if not declared:
        return language_name(DEFAULT_LANG)
    for preferred in (market.home_lang, "en"):
        if preferred in declared:
            return language_name(preferred)
    return language_name(declared[0])


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
    "'přesně takovou posilu jsme hledali'). Achieve neutrality by RECASTING, never by breaking "
    "grammar: no plural agreement for one person (not 'jste věnovali' to an individual), no "
    "slash forms ('věnoval/a') — prefer nominal or present-tense constructions that need no "
    "gendered participle ('Děkujeme za Váš čas', 'Vaše zkušenosti nás zaujaly').\n"
    "The SENDER is the hiring team: keep first-person plural consistently ('rádi bychom', never "
    "'ráda bychom'), and keep the formal register (vykání) consistent to the last sentence — one "
    "slip into tykání ruins an otherwise formal letter.\n"
    "Write ONLY in the requested language — never mix in words or characters from any other "
    "language or script.\n"
)


def _letter_context(candidate: MatchCandidate, job: Job, m: Any | None = None) -> dict[str, Any]:
    """Compact candidate×job evidence for the candidate-facing letter prompts.

    The 2026-08-11 bench found the letters starved: outreach saw a name + three
    skill strings, rejection not even the match — so no model COULD personalize,
    and every judge verdict read "pasteable onto any candidate". This is the
    letters' shared fact base; each prompt states what to anchor on."""
    ctx: dict[str, Any] = {
        "candidate": {
            "name": candidate.label,
            "seniority": candidate.seniority,
            "summary": candidate.summary or None,
            "skills": candidate.skills[:10],
            "experienceHighlights": candidate.experience_highlights[:3],
            "aspirations": candidate.aspirations[:3] or None,
        },
        "job": {
            "title": job.title,
            "company": job.company,
            "seniority": job.seniority,
            "location": job.location or None,
            "workMode": job.work_mode or None,
            "keySkills": (job.detected_skills or [])[:8],
            "descriptionExcerpt": (job.description or "")[:400] or None,
        },
    }
    if m is not None:
        ctx["match"] = {
            "total": m.total,
            "tier": m.fit_tier,
            "matchedSkills": m.matched_skills[:8],
            "missingMustHaves": m.missing_skills[:6],
        }
    return ctx


# Shared grounding rule for every candidate-facing letter: the failure mode the
# bench surfaced was not fluency but unsupported claims and unused evidence.
_LETTER_GROUNDING = (
    "Ground every claim in the supplied facts: never assert meetings, team reactions, benefits, "
    "interest, or abilities that are not in them. Anchor the message on the STRONGEST "
    "candidate-specific hooks available, in this order: (1) a stated aspiration that maps to this "
    "role or company, (2) a concrete experience highlight, (3) the matched skills. Name at least "
    "two specific facts from THIS candidate's profile — if the body could be sent to a different "
    "candidate unchanged, it is wrong.\n"
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
        f"Draft a short, warm first-contact outreach message in {lang} inviting this candidate to apply. "
        "Use ONLY these facts:\n"
        f"{json.dumps(_letter_context(candidate, job), ensure_ascii=False, indent=2)}\n\n"
        f"Matched strengths to weave in naturally: {', '.join(strong) or 'their background'}.\n"
        + _LETTER_GROUNDING
        + "Open with the candidate's name. Say in one sentence what is DISTINCTIVE about this role "
        "(from the job facts — its stack, product, or context), so they see why it fits THEM "
        "specifically. Where the candidate's background differs from the role's stack, address the "
        "bridge honestly instead of ignoring it.\n"
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
        f"Draft a respectful, specific, fair rejection message in {lang} for this candidate, who reached the "
        f"{stage} stage. Use ONLY these facts:\n"
        f"{json.dumps(_letter_context(candidate, job, m), ensure_ascii=False, indent=2)}\n\n"
        "The body must name the ACTUAL decisive reason, kindly and concretely — drawn from "
        "missingMustHaves or the match tier, never a generic 'we proceeded with other candidates' "
        "alone. When missingMustHaves is empty and the tier is strong, do NOT invent a skill gap "
        "(a claimed gap the candidate's own highlights disprove is the worst possible letter): the "
        "honest reason is that another candidate matched this role's specific needs even more "
        "closely — say that gracefully. Acknowledge one real strength from their profile so the "
        "message reads as considered, not templated.\n"
        "Feedback rules — the feedback must survive a check against the candidate's own evidence: "
        "never advise adding something their profile already shows (check experienceHighlights and "
        "skills first); never presuppose work they do not have; advise the one step that most "
        "narrows THIS role's gap. Leave feedback an empty string rather than write generic advice.\n"
        "Never disclose other candidates; never use protected-characteristic language.\n"
        + _LETTER_GROUNDING
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
        + "Anchor every question in a CONCRETE piece of this candidate's evidence — a named project "
        "or highlight, not a bare skill ('In the ingestion rebuild you describe, how did you…', "
        "never 'walk me through a time you used X'). Questions must verify, not assume: no premise "
        "the evidence doesn't state. Cover the missing must-haves AND, when the candidate states an "
        "aspiration (e.g. lead/architect ambitions), include one question probing readiness for it.\n"
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


# Character budget for the transcript handed to the scorecard prompt. MUST match
# MAX_SCORECARD_NOTES_CHARS in app/_lib/interview-transcript.ts — the TS side
# already samples to this budget, so a TS-produced note passes through untouched
# and only a non-TS caller is ever sampled here.
MAX_SCORECARD_NOTES_CHARS = 6000


def sample_scorecard_notes(notes: str | None, limit: int = MAX_SCORECARD_NOTES_CHARS) -> str:
    """Head+tail sample of an interview transcript, preserving the CLOSING turns.

    A naive ``notes[:limit]`` front-slice deletes the end of the call — which is
    precisely where the interviewer's read-back of the candidate's stack lives.
    The scorecard prompt instructs the model to treat that confirmation as the
    AUTHORITATIVE record of the candidate's technologies, overriding earlier ASR
    mishearings ("React" heard as "Rust"), so dropping it left the model trusting
    a confirmation it could no longer see and silently falling back to the raw
    early turns the prompt explicitly warns about (UAT TZ-VI-L1-02 / PVI-L1-01).

    Mirrors the head+tail strategy the TS side already uses, with an in-band
    marker so an elided transcript always announces itself rather than reading as
    a complete one.
    """
    text = notes or ""
    if len(text) <= limit:
        return text
    marker = "\n…[transcript elided]…\n"
    budget = max(0, limit - len(marker))
    # Bias to the tail: the read-back and the close matter more to a rating than
    # the middle of the call, while the head still carries the role framing.
    head = budget // 2
    tail = budget - head
    return f"{text[:head]}{marker}{text[len(text) - tail:]}"


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
        # Head+tail sampled, NOT front-sliced: the read-back this prompt calls
        # AUTHORITATIVE a few lines below lives at the END of the call.
        f"interviewer notes / transcript:\n\"\"\"{sample_scorecard_notes(notes)}\"\"\"\n\n"
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
        # Read-back trust rule (docs/_archive/interview-improvement-inputs.md §2/§5): the brief now has the
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

# The seniority fallback bands used when a job carries no salary_band of its own
# now live on MarketConfig (`seniority_default_bands`) — they were CZK/month
# magnitudes stamped with the ACTIVE market's currency, so a re-homed deploy drafted
# a candidate-facing "95,000 EUR gross monthly", wrong by ~25×. The Czech default
# reproduces the previous literals byte-for-byte; a market with NO configured bands
# returns no figure at all (see _fallback_band / draft_offer).


def _fallback_band(job: Job, market: MarketConfig) -> tuple[int, int] | None:
    """The market's seniority fallback band for ``job``, or ``None`` when the market
    has none configured.

    An unmapped/absent seniority resolves through ``"medior"``, reproducing the old
    ``.get(seniority, [65000, 95000])`` fallback exactly for the Czech default.
    ``None`` is the FAIL-SAFE answer for an uncalibrated market — never another
    market's magnitudes relabelled in this one's currency."""
    bands = market.seniority_default_bands
    if not bands:
        return None
    band = bands.get((job.seniority or "medior").lower()) or bands.get("medior")
    return (int(band[0]), int(band[1])) if band else None


def _round_k(value: float) -> int:
    return int(round(value / 1000.0)) * 1000


def draft_offer(candidate: MatchCandidate, job: Job, m, *, lang: str | None = None, provider: Any | None = None):
    """Propose a number inside the role's salary band (scaled by fit) + draft the offer letter."""
    market = ACTIVE_MARKET
    band: tuple[int, int] | None = None
    raw = list(getattr(job, "salary_band", None) or [])
    if len(raw) >= 2 and raw[0] > 0 and raw[1] >= raw[0]:
        band = (int(raw[0]), int(raw[1]))
    else:
        # No band on the job — fall back to the MARKET's seniority bands, which may
        # legitimately be absent (an uncalibrated market). See _fallback_band.
        band = _fallback_band(job, market)
    # The offer figure is denominated in the ACTIVE market's currency, not a
    # hardcoded "CZK" — byte-identical ("CZK") for the Czech default, but a re-homed
    # market labels the offer in ITS own currency instead of silently mislabelling it.
    currency = market.currency
    lang = _letter_lang(candidate, lang)
    # The pay PERIOD is the market's too — "Gross monthly" was hardcoded beside a
    # market-driven currency, so a year-denominated market claimed a monthly figure.
    period_en = gross_period_phrase(market.period, "en")
    period_cs = gross_period_phrase(market.period, "cs")

    if band is None:
        # FAIL SAFE. We hold no band for this market and the job carries none, so
        # there is no defensible number — and an invented one reaches the candidate.
        # Emit no figure: the draft still routes to the human offer_review gate
        # (setApproval in automation-run.ts), where a recruiter sets the real one.
        lo = hi = recommended = None
        f = 0.0
        rationale = (
            f"No salary band is configured for the '{market.market_id}' market and this posting carries none, "
            f"so no figure was proposed — set the {currency} amount when approving this offer. "
            f"(Fresh fit check at offer draft: {m.total}/100.)"
        )
        figure_line = (
            "Do NOT state, estimate, imply, or hint at any compensation figure, band, or range — none has been "
            "decided. Say the compensation details will be confirmed in the conversation. "
            "Convey genuine enthusiasm and invite them to discuss. Keep it concise."
        )
    else:
        lo, hi = band
        # Position within the band scales with match strength (match 55 -> 10%, 95 -> 90%).
        f = max(0.1, min(0.9, (m.total - 55) / 40.0))
        recommended = max(lo, min(hi, _round_k(lo + (hi - lo) * f)))
        # Name the producer (REC-01/OO-L2-10): this number is a FRESH fit check run at
        # draft time — NOT the entry's stored match score the approval-card header
        # shows — so the prose must never read as bare "Match N/100".
        rationale = (
            f"Fresh fit check {m.total}/100 at offer draft places the offer at ~{int(round(f * 100))}% of the "
            f"{lo:,}–{hi:,} {currency} band for this {job.seniority or 'mid'}-level role."
        )
        figure_line = (
            f"{period_en.capitalize()} compensation offered: {recommended:,} {currency}. "
            "Convey genuine enthusiasm, state the figure exactly once, and invite them to discuss. Keep it concise."
        )

    prompt = (
        f"Draft a warm, professional job-offer message in {lang} for this candidate. Use ONLY these facts:\n"
        f"{json.dumps(_letter_context(candidate, job, m), ensure_ascii=False, indent=2)}\n\n"
        + figure_line + "\n"
        + "Say WHY the team is making this offer by citing one or two real facts from the candidate's "
        "profile (a matched strength, a concrete highlight, a stated aspiration this role serves) — "
        "never invented sentiment ('the team loved meeting you') the facts don't contain. Allude to "
        "an aspiration professionally rather than quoting it back verbatim ('a role with room to "
        "grow toward X', not 'your goal is X'). Write with the settled confidence of a DECIDED "
        "offer — never pitch them to apply. Mention the work mode when the job facts state one.\n"
        + _LETTER_GROUNDING
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
        # The pay sentence is dropped entirely when no band is configured — an offer
        # letter that names no figure is honest; one that names an invented figure is
        # not, and this letter is candidate-facing.
        if lang == "Czech":
            subject = f"Nabídka pozice {job.title} — {job.company}"
            pay = (
                f" Navrhovaná {period_cs} mzda je {recommended:,} {currency}."
                if recommended is not None
                else " Konkrétní podmínky odměňování rádi upřesníme při osobním jednání."
            )
            body = (
                f"Dobrý den {candidate.label},\n\nje nám potěšením nabídnout Vám pozici {job.title} ve společnosti "
                f"{job.company}.{pay} Rádi vše osobně probereme "
                "a zodpovíme případné dotazy.\n\nS pozdravem,\nNáborový tým"
            )
        else:
            subject = f"Offer: {job.title} at {job.company}"
            pay = (
                f" The proposed {period_en} compensation is {recommended:,} {currency}."
                if recommended is not None
                else " We'll confirm the compensation details together when we talk."
            )
            body = (
                f"Hi {candidate.label},\n\nwe're delighted to offer you the {job.title} role at {job.company}.{pay} "
                "We'd love to walk you through "
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
            # All three are None together when the market has no configured band and
            # the job carries none — the honest "we did not price this" shape. The
            # draft still goes to the human offer_review gate, where the recruiter
            # sets the figure; nothing downstream may invent one.
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
