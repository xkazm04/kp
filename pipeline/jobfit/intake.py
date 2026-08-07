"""Role-intake dialog engine — the conversation that fills a RoleBrief.

Phase 1 of docs/concepts/role-intake-dialog.md. One stateless exchange per
call: the route hands in the transcript so far, the current RoleBrief and the
requestor's new message; this module returns the agent's reply plus the
re-extracted brief (and the detected session shape). The persona is the
evidence-backed spec in docs/development/role-intake-research.md — change the
rules there first, then here.

Register: coaching session, not interrogation. The requestor (team lead / HR)
is the private side — the agent reads back, confirms, proposes, and lets them
correct it. This deliberately INVERTS the candidate interviewer's withholding
stance (student-interview.py's no-feedback/no-scores rules do not apply).

Turn roles reuse the cross-plane VoiceTurn contract: "interviewer" = the
intake agent, "candidate" = the REQUESTOR (legacy name kept so transcript
tooling works unchanged).

LLM path + deterministic fallback via the shared provenance runner
(generate_with_fallback): keyless, the dialog degrades to the scripted
slot-filling script below — a guided form in chat clothing that fills the same
RoleBrief with provenance "stated" for everything the requestor typed.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .devcase.provenance import fenced_untrusted, generate_with_fallback
from .i18n import language_directive, normalize_lang
from .rolebrief import BriefFacet, BriefRequirement, RoleBrief, coerce_role_brief

_LOG = logging.getLogger(__name__)

INTAKE_PROMPT_VERSION = "role-intake-v1"
MAX_REPLY_CHARS = 1_600
MAX_MESSAGE_CHARS = 4_000
MAX_TRANSCRIPT_TURNS = 48  # most recent turns fed back for continuity

SHAPES = ("power_unit", "story")

# ---------------------------------------------------------------------------
# Persona (docs/development/role-intake-research.md §3 — the 10 rules)
# ---------------------------------------------------------------------------

_PERSONA_CORE = (
    "You are a warm, sharp talent advisor running a role-intake conversation with a hiring requestor "
    "(a team lead or HR partner) who needs to fill a role. This is a coaching session, not an "
    "interrogation: there is nothing to pass or fail, and you say that plainly when the requestor "
    "seems unsure — vague answers are exactly what this session is for. You are on their side of the "
    "table: read back what you heard, confirm it, propose, and let them correct you."
)

_PERSONA_TECHNIQUE = (
    "Technique, in order of importance: "
    "(1) Ask exactly ONE question per turn and wait. "
    "(2) Reflect before you ask — roughly two reflections per question, as expansion paraphrases "
    "('so the last two hires drowned in on-call — what else was going on?'), never yes/no checklist "
    "read-backs. "
    "(3) Reuse the requestor's exact words until they have unpacked them — if they say 'firefighter "
    "type', keep saying 'firefighter', do not translate it into your own vocabulary. "
    "(4) Ladder every hard requirement once: what goes wrong today without it, and what it protects. "
    "A requirement that survives laddering is a must-have; one that doesn't gets gently demoted to "
    "nice-to-have — never argue, reflect the trade-off and let them decide. "
    "(5) If they open with a solution ('I need a senior React dev'), park it visibly ('noted — a "
    "senior React profile') and explore the problem behind it before it enters the brief. "
    "(6) Name contradictions aloud as dig sites: 'I'm hearing two different things about seniority — "
    "can we pull that apart?' "
    "(7) Offer a this-or-that contrast ('closer to a firefighter or an architect?') ONLY after an "
    "open question has stalled, and frame it as disposable — 'neither is fine'. "
    "(8) Anchor requirements in outcomes: ask what this person should have gotten DONE in the first "
    "90 days, and use it as the filter — a must-have that maps to no 90-day outcome is a nice-to-have. "
    "(9) When must-haves exceed six, ask the requestor to rank the top three rather than accepting "
    "the list. "
    "(10) Keep every turn short: at most a few sentences of reflection plus one question."
)

_PERSONA_SHAPE = (
    "Session shape: triage within your first two questions. If this is a KNOWN role — a backfill, a "
    "clone of an existing seat, 'same as the old JD' — collapse to the short path: confirm the "
    "essentials (title, the 90-day outcome, top must-haves, seniority), read the brief back, and "
    "finish; do not force coaching depth on a transactional request. Only sustained vagueness, "
    "contradiction, or solution-words-without-a-problem earn the longer exploratory path (goal, then "
    "current reality, then options, then commitment)."
)

_PERSONA_CLOSE = (
    "Ending: when the brief covers the role's core — title, 90-day outcomes, graded requirements, "
    "seniority — deliver a structured read-back summary of everything captured, invite ONE open "
    "correction ('what did I get wrong or miss?'), and after the requestor confirms, close the "
    "session by including the token <<END>> at the end of your final turn. Never emit <<END>> "
    "before a read-back was confirmed."
)

_EXTRACTION_RULES = (
    "With every reply, re-emit the FULL updated RoleBrief as JSON. Carry over everything already in "
    "the current brief — never drop a field you are not changing. Provenance discipline is a hard "
    "rule: 'stated' ONLY for values the requestor actually said or explicitly confirmed; your own "
    "proposals and readings-between-lines are 'inferred' (with honest confidence 0..1); template "
    "assumptions are 'default'. Grade requirements: kind must_have|nice_to_have, hardness "
    "prerequisite|learnable, weight 0..1 within the kind. Facets are open-vocabulary "
    "{key,label,value,importance:core|valuable|context} slots for everything situational — "
    "team_context, why_now, urgency, budget_band, success_90d context, dealbreaker_context, "
    "work_environment. Set shape to 'power_unit' or 'story' once triaged; set done=true only "
    "together with your confirmed <<END>> close."
)


def intake_system_brief(lang: str = "en") -> str:
    """The intake agent's system prompt — persona + extraction contract."""
    return " ".join(
        [
            _PERSONA_CORE,
            _PERSONA_TECHNIQUE,
            _PERSONA_SHAPE,
            _PERSONA_CLOSE,
            _EXTRACTION_RULES,
            language_directive(lang),
        ]
    )


# ---------------------------------------------------------------------------
# Transcript helpers
# ---------------------------------------------------------------------------

_ROLE_LABEL = {"interviewer": "AGENT", "candidate": "REQUESTOR", "system": "SYSTEM"}


def render_transcript(turns: list[dict]) -> str:
    recent = turns[-MAX_TRANSCRIPT_TURNS:]
    return "\n".join(f"{_ROLE_LABEL.get(str(t.get('role')), 'REQUESTOR')}: {str(t.get('text', '')).strip()}" for t in recent)


def _requestor_turns(turns: list[dict]) -> list[str]:
    return [str(t.get("text", "")) for t in turns if t.get("role") == "candidate"]


def _agent_turns(turns: list[dict]) -> list[str]:
    return [str(t.get("text", "")) for t in turns if t.get("role") == "interviewer"]


# ---------------------------------------------------------------------------
# Session-shape triage (research doc §5) — deterministic; the LLM may override
# with its own triage but the heuristic is the floor and the keyless path.
# ---------------------------------------------------------------------------

_POWER_UNIT_MARKERS = re.compile(
    r"\b(backfill|replacement|same as|another one|one more|stejn[áéý]|náhrad|posil|další[hoí]?\s|clone|"
    r"the old jd|existing jd|jako minule)\b",
    re.IGNORECASE,
)
_STORY_MARKERS = re.compile(
    r"\b(not sure|no idea|we think|maybe|kind of|never had|new team|first hire|one role or two|"
    r"nejsem si jist|nev[íi]m|možná|nová? t[ýy]m|poprvé|nejsme si jisti)\b",
    re.IGNORECASE,
)


def detect_shape(turns: list[dict]) -> str | None:
    """Triage after the first 1-2 requestor turns; None = undecided (defaults to story later)."""
    said = " \n".join(_requestor_turns(turns)[:2])
    if not said.strip():
        return None
    if _POWER_UNIT_MARKERS.search(said):
        return "power_unit"
    if _STORY_MARKERS.search(said):
        return "story"
    if len(_requestor_turns(turns)) >= 2:
        return "story"
    return None


# ---------------------------------------------------------------------------
# Deterministic scripted path (keyless / fallback)
#
# A fixed, localized slot script that fills the same RoleBrief. Stateless: the
# slot a message answers is recovered by matching the agent's LAST question in
# the transcript against the script, so a skipped/failed run never loses its
# place. Slot order follows the research doc: context first (cognitive
# interview), outcomes before requirements (the 90-day de-spec device), musts
# before nices, then the read-back.
# ---------------------------------------------------------------------------

_Q: dict[str, dict[str, str]] = {
    "context": {
        "en": "Let's shape this role together — no wrong answers here; vague is fine, that's what this session is for. Think about the last month: where did the team feel the missing person most?",
        "cs": "Pojďme tu roli nadefinovat společně — nejsou tu žádné špatné odpovědi, klidně i mlhavě. Vzpomeňte si na poslední měsíc: kde tým nejvíc cítil, že tenhle člověk chybí?",
    },
    "title": {
        "en": "How would you call the role? A working title is enough.",
        "cs": "Jak byste roli nazvali? Stačí pracovní název.",
    },
    "success": {
        "en": "Imagine it's 90 days after they start and you're glad you hired them. What have they gotten done?",
        "cs": "Představte si, že je 90 dní po nástupu a jste rádi, že jste je přijali. Co mají hotovo?",
    },
    "musts": {
        "en": "Which capabilities are true dealbreakers — the ones without which those 90-day outcomes fail? One per line is fine.",
        "cs": "Které schopnosti jsou skutečně nezbytné — bez kterých by se ty výsledky za 90 dní nepovedly? Klidně jednu na řádek.",
    },
    "nices": {
        "en": "And what would be a bonus — nice to have, but trainable on the job?",
        "cs": "A co by bylo příjemným bonusem — hodí se, ale jde to doučit za pochodu?",
    },
    "seniority": {
        "en": "Level-wise, is this closer to junior, medior, senior, or lead? Neither is fine — say what feels right.",
        "cs": "Úrovní je to spíš junior, medior, senior, nebo lead? Klidně od oka.",
    },
    "languages": {
        "en": "Which working languages must they speak? Skip if it doesn't matter.",
        "cs": "Jaké pracovní jazyky musí ovládat? Klidně přeskočte, pokud na tom nezáleží.",
    },
    "team": {
        "en": "Who will they work with day to day — team size, who they report to?",
        "cs": "S kým budou denně pracovat — jak velký tým, komu se zodpovídají?",
    },
    "urgency": {
        "en": "What happens if the seat stays empty another quarter?",
        "cs": "Co se stane, když místo zůstane neobsazené ještě čtvrt roku?",
    },
    "budget": {
        "en": "Any compensation range in mind? Totally fine to skip this one.",
        "cs": "Máte představu o mzdovém rozpětí? Klidně přeskočte.",
    },
}

_SKIP_WORDS = re.compile(r"^\s*(skip|no|none|ne|nevím|nemám|later|-|—)\s*\.?\s*$", re.IGNORECASE)

_SENIORITY_TOKENS = ("junior", "medior", "senior", "lead")


def _split_items(text: str) -> list[str]:
    parts = re.split(r"[\n;,•]+|(?:^|\s)-\s+", text)
    return [p.strip(" .\t") for p in parts if p and p.strip(" .\t") and len(p.strip()) > 1][:12]


def _stated_facet(key: str, label: str, value: str, importance: str = "valuable") -> BriefFacet:
    return BriefFacet(key=key, label=label, value=value.strip()[:600], importance=importance, provenance="stated", confidence=0.9)


def _apply_answer(brief: RoleBrief, slot: str, text: str) -> RoleBrief:
    """Fold the requestor's answer to `slot` into the brief. Everything here is
    the requestor's literal input → provenance 'stated'."""
    text = text.strip()[:MAX_MESSAGE_CHARS]
    if not text or _SKIP_WORDS.match(text):
        return brief
    if slot == "context":
        brief.facets.append(_stated_facet("why_now", "Why now", text, "core"))
    elif slot == "title":
        brief.title = text.splitlines()[0].strip(" .")[:120]
    elif slot == "success":
        brief.success_criteria.extend(_split_items(text) or [text[:300]])
    elif slot == "musts":
        for skill in _split_items(text) or [text[:120]]:
            brief.requirements.append(
                BriefRequirement(skill=skill[:120], kind="must_have", hardness="prerequisite", weight=0.8, provenance="stated", confidence=0.9)
            )
    elif slot == "nices":
        for skill in _split_items(text) or [text[:120]]:
            brief.requirements.append(
                BriefRequirement(skill=skill[:120], kind="nice_to_have", hardness="learnable", weight=0.4, provenance="stated", confidence=0.9)
            )
    elif slot == "seniority":
        lowered = text.lower()
        for token in _SENIORITY_TOKENS:
            if token in lowered:
                brief.seniority = token
                break
    elif slot == "languages":
        brief.languages.extend([l[:40] for l in _split_items(text)][:5])
    elif slot == "team":
        brief.facets.append(_stated_facet("team_context", "Team context", text))
    elif slot == "urgency":
        brief.facets.append(_stated_facet("urgency", "Urgency", text, "core"))
    elif slot == "budget":
        brief.facets.append(_stated_facet("budget_band", "Compensation", text, "context"))
    return brief


def _slot_filled(brief: RoleBrief, slot: str) -> bool:
    if slot == "context":
        return any(f.key == "why_now" for f in brief.facets)
    if slot == "title":
        return bool(brief.title)
    if slot == "success":
        return bool(brief.success_criteria)
    if slot == "musts":
        return any(r.kind == "must_have" for r in brief.requirements)
    if slot == "nices":
        return any(r.kind == "nice_to_have" for r in brief.requirements)
    if slot == "seniority":
        return False  # asked-once semantics (the default 'medior' is indistinguishable from unset)
    if slot == "languages":
        return bool(brief.languages)
    if slot == "team":
        return any(f.key == "team_context" for f in brief.facets)
    if slot == "urgency":
        return any(f.key == "urgency" for f in brief.facets)
    if slot == "budget":
        return any(f.key == "budget_band" for f in brief.facets)
    return False


def _script_for(shape: str | None) -> list[str]:
    # The short path confirms essentials only (research doc §5: ≤8 turns);
    # the story path runs the full script, outcomes before requirements.
    if shape == "power_unit":
        return ["context", "title", "success", "musts", "seniority", "budget"]
    return ["context", "title", "success", "musts", "nices", "seniority", "languages", "team", "urgency", "budget"]


def _asked_slots(turns: list[dict]) -> set[str]:
    """Which scripted questions were already asked — matched by a stable prefix
    of the localized question text (stateless slot recovery)."""
    agent_said = "\n".join(_agent_turns(turns))
    asked: set[str] = set()
    for slot, variants in _Q.items():
        for text in variants.values():
            if text[:40] in agent_said:
                asked.add(slot)
                break
    return asked


def _readback(brief: RoleBrief, lang: str) -> str:
    musts = [r.skill for r in brief.requirements if r.kind == "must_have"]
    nices = [r.skill for r in brief.requirements if r.kind == "nice_to_have"]
    if lang == "cs":
        lines = [f"Tady je, co jsem si odnesl — opravte mě prosím, jestli něco nesedí:"]
        lines.append(f"• Role: {brief.title or '—'} ({brief.seniority})")
        if brief.success_criteria:
            lines.append(f"• Za 90 dní hotovo: {'; '.join(brief.success_criteria[:4])}")
        if musts:
            lines.append(f"• Nezbytné: {', '.join(musts[:8])}")
        if nices:
            lines.append(f"• Výhodou: {', '.join(nices[:8])}")
        if brief.languages:
            lines.append(f"• Jazyky: {', '.join(brief.languages)}")
        for f in brief.facets:
            if f.key in ("team_context", "urgency", "budget_band", "why_now"):
                lines.append(f"• {f.label}: {f.value[:160]}")
        lines.append("Co jsem pochopil špatně nebo co chybí? Pokud nic, brief uložím. <<END>>")
        return "\n".join(lines)
    lines = ["Here's what I took away — please correct anything that's off:"]
    lines.append(f"• Role: {brief.title or '—'} ({brief.seniority})")
    if brief.success_criteria:
        lines.append(f"• Done in 90 days: {'; '.join(brief.success_criteria[:4])}")
    if musts:
        lines.append(f"• Dealbreakers: {', '.join(musts[:8])}")
    if nices:
        lines.append(f"• Nice to have: {', '.join(nices[:8])}")
    if brief.languages:
        lines.append(f"• Languages: {', '.join(brief.languages)}")
    for f in brief.facets:
        if f.key in ("team_context", "urgency", "budget_band", "why_now"):
            lines.append(f"• {f.label}: {f.value[:160]}")
    lines.append("What did I get wrong or miss? If nothing, I'll save the brief. <<END>>")
    return "\n".join(lines)


def deterministic_turn(turns: list[dict], brief: RoleBrief, message: str, lang: str) -> dict:
    """The keyless scripted exchange: apply the message to the slot the agent
    last asked about, then ask the first remaining slot (or read back + end)."""
    shape = detect_shape(turns + ([{"role": "candidate", "text": message}] if message else []))
    asked = _asked_slots(turns)
    script = _script_for(shape)

    # Recover which slot the new message answers: the LAST scripted question the
    # agent asked. (Slots can be asked out of script order after a shape flip.)
    answered_slot: str | None = None
    for said in reversed(_agent_turns(turns)):
        for slot, variants in _Q.items():
            if any(text[:40] in said for text in variants.values()):
                answered_slot = slot
                break
        if answered_slot:
            break
    if answered_slot and message:
        brief = _apply_answer(brief, answered_slot, message)

    remaining = [s for s in script if s not in asked and not _slot_filled(brief, s)]
    if remaining:
        slot = remaining[0]
        reply = _Q[slot].get(lang, _Q[slot]["en"])
        return {"reply": reply, "brief": brief.model_dump(by_alias=True), "shape": shape, "done": False}
    # Script exhausted → read back and close.
    return {"reply": _readback(brief, lang), "brief": brief.model_dump(by_alias=True), "shape": shape or "story", "done": True}


# ---------------------------------------------------------------------------
# Brief merge — protects accumulated state from an LLM that forgets fields
# ---------------------------------------------------------------------------


def merge_brief(base: RoleBrief, update: RoleBrief) -> RoleBrief:
    """Fold an LLM-re-emitted brief onto the accumulated one. Union semantics:
    an update can revise or add, but silently DROPPING something the requestor
    already stated must not lose it — base entries absent from the update are
    kept. Scalars: update wins when it says something (non-empty)."""
    merged = base.model_copy(deep=True)
    if update.title:
        merged.title = update.title
    if update.summary:
        merged.summary = update.summary
    if update.seniority and update.seniority != "medior":
        merged.seniority = update.seniority
    elif update.seniority == "medior" and not merged.seniority:
        merged.seniority = "medior"
    if update.role_family and update.role_family != "software_engineering":
        merged.role_family = update.role_family

    def union(base_list: list[str], new_list: list[str], cap: int) -> list[str]:
        seen = {v.strip().lower() for v in base_list}
        out = list(base_list)
        for v in new_list:
            if v.strip().lower() not in seen:
                out.append(v)
                seen.add(v.strip().lower())
        return out[:cap]

    merged.languages = union(merged.languages, update.languages, 6)
    merged.responsibilities = union(merged.responsibilities, update.responsibilities, 12)
    merged.success_criteria = union(merged.success_criteria, update.success_criteria, 8)

    by_skill = {r.skill.strip().lower(): i for i, r in enumerate(merged.requirements)}
    for req in update.requirements:
        key = req.skill.strip().lower()
        if key in by_skill:
            existing = merged.requirements[by_skill[key]]
            # A stated grading never regresses to an inferred one.
            if existing.provenance == "stated" and req.provenance != "stated":
                continue
            merged.requirements[by_skill[key]] = req
        else:
            merged.requirements.append(req)
            by_skill[key] = len(merged.requirements) - 1
    merged.requirements = merged.requirements[:24]

    by_key = {f.key: i for i, f in enumerate(merged.facets) if f.key}
    for facet in update.facets:
        if facet.key and facet.key in by_key:
            existing = merged.facets[by_key[facet.key]]
            if existing.provenance == "stated" and facet.provenance != "stated":
                continue
            merged.facets[by_key[facet.key]] = facet
        else:
            merged.facets.append(facet)
            if facet.key:
                by_key[facet.key] = len(merged.facets) - 1
    merged.facets = merged.facets[:20]
    merged.prompt_version = INTAKE_PROMPT_VERSION
    return merged


# ---------------------------------------------------------------------------
# The per-exchange entry point
# ---------------------------------------------------------------------------


def opening_turn(lang: str = "en") -> dict:
    """The session opener — ALWAYS deterministic (identical keyless and keyed):
    greeting + explicit non-judgment + the context-reinstatement question."""
    lang = normalize_lang(lang)
    return {
        "reply": _Q["context"].get(lang, _Q["context"]["en"]),
        "brief": RoleBrief(prompt_version=INTAKE_PROMPT_VERSION).model_dump(by_alias=True),
        "shape": None,
        "done": False,
        "source": "deterministic",
    }


def run_intake_turn(
    provider: Any | None,
    turns: list[dict],
    brief_payload: Any,
    message: str,
    lang: str = "en",
) -> dict:
    """One exchange: requestor `message` in → agent reply + updated brief out.

    `turns` is the transcript BEFORE this message (the new message is fenced
    separately — devcase/chat.py's exactly-once rule). Returns
    {reply, brief, shape, done, source, fallbackReason?}.
    """
    lang = normalize_lang(lang)
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    base = coerce_role_brief(brief_payload)
    base.prompt_version = INTAKE_PROMPT_VERSION

    def deterministic() -> dict:
        return deterministic_turn(turns, base.model_copy(deep=True), message, lang)

    def coerce(payload: Any) -> dict:
        raw = payload if isinstance(payload, dict) else {}
        reply = str(raw.get("reply") or "").strip()[:MAX_REPLY_CHARS]
        if not reply:
            raise ValueError("intake turn returned no reply")
        update = coerce_role_brief(raw.get("brief"))
        merged = merge_brief(base, update)
        shape = raw.get("shape") if raw.get("shape") in SHAPES else detect_shape(turns + [{"role": "candidate", "text": message}])
        done = bool(raw.get("done")) and "<<END>>" in reply
        return {"reply": reply, "brief": merged.model_dump(by_alias=True), "shape": shape, "done": done}

    prompt = (
        f"CURRENT BRIEF (accumulated so far):\n{json.dumps(base.model_dump(by_alias=True), ensure_ascii=False)}\n\n"
        f"CONVERSATION SO FAR:\n{render_transcript(turns)}\n\n"
        f"{fenced_untrusted('REQUESTOR_MESSAGE', message)}\n\n"
        "Produce your next single turn as the intake agent, applying the technique rules. "
        'Respond as JSON: {"reply": "...", "brief": {...the FULL updated RoleBrief...}, '
        '"shape": "power_unit"|"story"|null, "done": false|true}.'
    )

    artifact, source = generate_with_fallback(
        provider,
        prompt,
        intake_system_brief(lang),
        deterministic,
        coerce,
        _LOG,
        expected_keys=("reply", "brief"),
    )
    artifact["source"] = source
    return artifact
