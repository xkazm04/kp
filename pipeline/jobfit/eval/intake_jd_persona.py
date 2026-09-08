"""A hiring REQUESTOR persona grounded in one real job description.

The registry standard for this dialog (knowledge/recruiting/role-definition/
role-intake-conversation) is explicit about who the human on the other side is:
the REQUESTOR — the hiring manager who wants the role filled — not a second
interviewer and not the candidate. A JD-grounded persona therefore:

* answers **in the JD's own words**, one topic per answer, 1-3 sentences;
* **admits "not decided yet"** for anything the JD is silent about (compensation
  is the standing example) and never invents a fact;
* can name a **dealbreaker** when asked, because the JD states hard requirements;
* does **not dump the whole JD** — the document is the persona's private
  knowledge, quoted from on demand.

Two products come out of one posting:

* :func:`requestor_prompt_from_jd` — the live-mode system prompt (the JD rides
  in a fenced block the persona may quote from).
* :func:`golden_answers_from_jd` — the offline mode's deterministic answers, in
  the exact order the keyless script asks for them
  (``intake._script_for``): context → title → outcome → must-haves →
  seniority → budget → confirm for a ``power_unit`` session, and the longer
  story script for ``story``.

The scenario's declared ``family`` is not the corpus's ``role_family`` field: it
is what the intake pipeline ITSELF classifies from the deterministic dialog
(:func:`deterministic_family`), because that is the value ``check_dialog``'s
``role_family`` invariant compares against. The JD's own family is carried
alongside as ``jd_role_family`` so a divergence between "what the posting says"
and "what the dialog captured" is visible in the dump rather than hidden inside
a passing check.
"""

from __future__ import annotations

import re
from typing import Any

from ..intake import opening_turn, run_intake_turn
from .intake_corpus import Posting, slugify

# Sentences that read like a stated requirement. Deliberately plain-English
# cues: the corpora are EN, and a cue list is auditable where a model is not.
_REQUIREMENT_CUES = (
    "experience",
    "required",
    "requirement",
    "must ",
    "must-",
    "knowledge",
    "proficien",
    "ability to",
    "skills",
    "degree",
    "licence",
    "license",
    "certification",
    "certified",
    "fluent",
    "years",
    "familiar",
)
_OUTCOME_CUES = (
    "responsib",
    "you will",
    "will be",
    "own ",
    "manage",
    "lead",
    "deliver",
    "support",
    "maintain",
    "coordinat",
)
# Everything _split_items (intake.py) would tear a single answer apart on. A
# must-have list is joined with ", ", so each ITEM must be free of these.
_ITEM_BREAKERS = re.compile(r"[\n;,•]+|(?:^|\s)-\s+")
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")

MAX_ITEM_CHARS = 80
MAX_LINE_CHARS = 220


def _sentences(body: str) -> list[str]:
    out: list[str] = []
    for chunk in _SENTENCE.split(body or ""):
        text = " ".join(chunk.split()).strip(" -•\t")
        if len(text) >= 12:
            out.append(text)
    return out


def _clean_item(text: str, limit: int = MAX_ITEM_CHARS) -> str:
    """One requirement item: no separator the answer parser would split on."""
    flat = " ".join(_ITEM_BREAKERS.sub(" ", text or "").split()).strip(" .")
    if len(flat) <= limit:
        return flat
    cut = flat[:limit].rsplit(" ", 1)[0]
    return (cut or flat[:limit]).strip(" .")


def _clean_line(text: str, limit: int = MAX_LINE_CHARS) -> str:
    """One prose answer (outcome, why-now): newlines flattened, length bounded."""
    flat = " ".join((text or "").split()).strip()
    if len(flat) <= limit:
        return flat
    return flat[:limit].rsplit(" ", 1)[0].strip(" .,")


def must_haves_from_jd(posting: Posting, limit: int = 3) -> list[str]:
    """Up to ``limit`` hard requirements, in the JD's own words.

    Bullets first (``requirements[]`` is appended to the body as bullets by the
    loader), then requirement-cue sentences, then a body-order fallback — a
    posting always yields at least one must-have, because a brief with none
    cannot pass ``brief_core`` and a scenario that cannot pass is not a test.
    """
    bullets = [
        _clean_item(line.lstrip("-• ").strip())
        for line in (posting.body or "").splitlines()
        if line.strip().startswith(("-", "•"))
    ]
    items = [b for b in bullets if len(b) > 2]
    if len(items) < limit:
        for sentence in _sentences(posting.body):
            lowered = sentence.lower()
            if any(cue in lowered for cue in _REQUIREMENT_CUES):
                item = _clean_item(sentence)
                if len(item) > 2 and item.lower() not in {i.lower() for i in items}:
                    items.append(item)
            if len(items) >= limit:
                break
    if not items:
        for sentence in _sentences(posting.body):
            item = _clean_item(sentence)
            if len(item) > 2:
                items.append(item)
            if len(items) >= limit:
                break
    if not items:
        items = [_clean_item(posting.title) or "relevant experience"]
    # De-duplicate case-insensitively, keep order.
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:limit]


# --- dealbreakers: the GROUND TRUTH for requirements_captured ---------------
#
# `unrouted_dealbreakers` matches a stated condition against a requirement row
# by substring, in both directions. That only measures anything if the stated
# condition is a SHORT NOUN PHRASE. The first cut of this module handed it
# whatever `must_haves_from_jd` produced — de-punctuated sentence fragments and,
# on JDs whose text carries its own headings, literal headings ("requirements",
# "job description") — so no requirement row could ever contain one, and every
# live role failed the check while its brief held the real conditions. The gate
# was right; the ground truth was garbage.
#
# So: phrases come only from requirement-flavoured contexts, are 2-5 words, and
# a JD that offers nothing that clean yields an EMPTY list — which makes
# `check_dialog` emit no `requirements_captured` key at all (the same way it
# skips `role_family` for a scenario with no family). No ground truth is
# reported as "—", never as a vacuous ✓.

_CREDENTIAL = re.compile(
    r"\b(bachelors? degree|masters? degree|associates degree|high school diploma|"
    r"valid drivers licen[cs]e|nursing licen[cs]e|cpa licen[cs]e|security clearance|"
    r"forklift licen[cs]e|registered nurse licen[cs]e)\b"
)
_REQUIREMENT_PHRASE = re.compile(
    r"(?:experience (?:with|in|using)|proficien\w* (?:with|in)|knowledge of|expertise in|"
    r"certification in|certified in|licensed in|degree in|familiarity with|skills? in|"
    r"background in|fluent in|fluency in)\s+((?:[a-z0-9+#./-]+ ){0,3}[a-z0-9+#./-]+)"
)
# Words that make a slice a sentence fragment rather than a noun phrase.
_PHRASE_STOP = {
    "and", "or", "with", "to", "in", "of", "for", "the", "a", "an", "our", "your", "their",
    "you", "we", "is", "are", "be", "as", "at", "on", "that", "this", "it", "its", "will",
    "must", "other", "all", "any", "etc",
}
_PHRASE_TRAILING_BAD = {
    "including", "such", "based", "within", "preferred", "using", "assists", "high",
    "significant", "working", "related", "plus", "years", "strong", "excellent",
    # A JD writes the condition as a sentence ("… is required"); the trailing
    # verb is not part of the noun phrase a requirement row would carry.
    "required", "requires", "needed", "essential", "necessary", "desired", "mandatory",
}
_PHRASE_LEADING_BAD = {"related", "lieu", "steps", "use", "most", "variety", "annual", "doing", "various", "new", "good"}
# A JD's own section headings are never a dealbreaker.
_PHRASE_BANNED = (
    "job description", "requirement", "qualification", "responsibilit", "benefit",
    "about us", "equal opportunity", "last updated", "skip to content", "position summary",
    "essential function", "please", "click", "apply",
)
MAX_PHRASE_WORDS = 5
MIN_PHRASE_WORDS = 2


def _phrase(raw: str) -> str:
    # A real JD is punctuated; the committed corpora are not. Strip the
    # punctuation the capture may have swallowed ("documentation." → "documentation")
    # so the phrase is comparable with a requirement row's skill either way.
    words = [w.strip(".,;:!?()-/") for w in (raw or "").split()]
    words = [w for w in words if w]
    while words and (words[-1] in _PHRASE_STOP or words[-1] in _PHRASE_TRAILING_BAD):
        words.pop()
    while words and (words[0] in _PHRASE_STOP or words[0] in _PHRASE_LEADING_BAD):
        words.pop(0)
    phrase = " ".join(words)
    if not (MIN_PHRASE_WORDS <= len(words) <= MAX_PHRASE_WORDS):
        return ""
    if len(phrase) < 6 or len(phrase) > 48:
        return ""
    if "andor" in phrase or any(len(w) < 2 for w in words):
        return ""
    if any(banned in phrase for banned in _PHRASE_BANNED):
        return ""
    return phrase


def dealbreakers_from_jd(posting: Posting, limit: int = 2) -> list[str]:
    """0-``limit`` lowercase noun phrases the JD states as hard conditions.

    EMPTY is a legitimate answer — many real postings are de-punctuated prose
    with no requirement-flavoured phrase in them, and inventing one would put a
    fragment into the ground truth that nothing can ever match.
    """
    text = " ".join((posting.body or "").lower().split())
    found: list[str] = []
    # Credentials first: they are the least ambiguous hard conditions a JD states.
    for match in list(_CREDENTIAL.finditer(text)) + list(_REQUIREMENT_PHRASE.finditer(text)):
        phrase = _phrase(match.group(1))
        if phrase and phrase not in found:
            found.append(phrase)
        if len(found) >= limit:
            break
    return found


def outcome_from_jd(posting: Posting) -> str:
    """The 90-day outcome line, derived from the first responsibilities sentence."""
    sentences = _sentences(posting.body)
    for sentence in sentences:
        lowered = sentence.lower()
        if any(cue in lowered for cue in _OUTCOME_CUES) and not sentence.startswith("-"):
            return _clean_line(f"In the first 90 days: {sentence}")
    if sentences:
        return _clean_line(f"In the first 90 days: {sentences[0]}")
    return _clean_line(f"In the first 90 days: runs the {posting.title} work without hand-holding")


def nice_to_have_from_jd(posting: Posting) -> str:
    """One nice-to-have — the fourth requirement item when the JD has one."""
    items = must_haves_from_jd(posting, limit=4)
    return items[3] if len(items) > 3 else "nothing else that is a hard condition"


def _jd_block(posting: Posting) -> str:
    body = posting.body if len(posting.body) <= 6000 else posting.body[:6000] + " …"
    header = f"{posting.title}" + (f" — {posting.company}" if posting.company else "")
    return f"<<<JOB_DESCRIPTION\n{header}\n\n{body}\nJOB_DESCRIPTION"


def requestor_prompt_from_jd(posting: Posting, lang: str = "en") -> str:
    """The live-mode system prompt for the JD-grounded hiring requestor."""
    dealbreakers = dealbreakers_from_jd(posting)
    non_negotiables = (
        "- Your NON-NEGOTIABLES are exactly these, in these words: "
        + "; ".join(f'"{d}"' for d in dealbreakers)
        + ". When you are asked what is required, what is non-negotiable, or what you would "
        "reject a candidate over, name them using those exact words — they are what the brief "
        "has to end up carrying.\n"
        if dealbreakers
        else "- The document does not pin down a hard, screenable condition. Say so if you are "
        "pushed for one, rather than inventing a threshold.\n"
    )
    return (
        "You are the HIRING MANAGER who wants this role filled — the requestor, not an "
        "interviewer and not a candidate. Someone from your talent team is interviewing YOU to "
        "capture what the role actually needs.\n\n"
        "The job description below is what you have in front of you. It is YOUR document: you "
        "may quote from it, but the interviewer has not read it.\n\n"
        f"{_jd_block(posting)}\n\n"
        "How you answer:\n"
        "- ONE topic per reply, answering only what was just asked. At most 3 sentences.\n"
        "- Use the job description's own words and concrete details wherever it has them.\n"
        "- NEVER invent a fact the document does not carry. If the JD is silent — compensation, "
        "budget, team size, start date — say plainly that it is not decided yet.\n"
        "- Never paste or summarise the whole document. Answer the question that was asked.\n"
        + non_negotiables
        + "- When the interviewer reads the role back to you, confirm it in one sentence if it is "
        "right, or correct exactly the part that is wrong.\n"
        f"- Reply in the language of the conversation (dialog language: {lang}).\n"
    )


def golden_answers_from_jd(posting: Posting, shape: str = "power_unit") -> list[str]:
    """Deterministic offline answers, in the keyless script's slot order.

    ``intake._script_for``:
    power_unit → context, title, success, musts, seniority, budget (+ confirm);
    story → context, title, success, musts, nices, seniority, languages, team,
    urgency, budget (+ confirm). The final "ok" answers the read-back, which is
    a separate exchange by contract (UAT L1-CONV-2).
    """
    # The dealbreaker phrases lead the must-have answer so each one lands as its
    # OWN requirements[] row (the answer is comma-split by `intake._split_items`)
    # — the offline half of the same contract the prompt states live.
    items = dealbreakers_from_jd(posting) + must_haves_from_jd(posting, limit=2)
    musts = ", ".join(items)
    outcome = outcome_from_jd(posting)
    company = posting.company or "the team"
    undecided = "Not decided yet — the job description does not state a band"
    if shape == "power_unit":
        return [
            f"It is a backfill — our {posting.title} at {company} left and we need the same again",
            posting.title,
            outcome,
            musts,
            posting.seniority,
            undecided,
            "ok",
        ]
    return [
        f"We have never had this role written down properly at {company} and the work is piling up",
        posting.title,
        outcome,
        musts,
        nice_to_have_from_jd(posting),
        posting.seniority,
        "English",
        f"The role sits with {company}",
        f"The {posting.title} work is not covered today",
        undecided,
        "ok",
    ]


def deterministic_brief(answers: list[str], lang: str = "en") -> dict:
    """Run the KEYLESS dialog over ``answers`` and return the resulting brief.

    The ``role_family`` invariant compares the brief's captured family against
    the scenario's declared one, so the declaration has to be what this exact
    pipeline classifies from this exact dialog — computed by replaying the
    dialog rather than by re-implementing the corpus intake builds internally
    (which would drift the first time intake.py changed a facet).
    """
    turns: list[dict] = [{"role": "interviewer", "text": opening_turn(lang)["reply"]}]
    brief: dict = opening_turn(lang)["brief"]
    for message in answers:
        result = run_intake_turn(None, turns, brief, message, lang=lang)
        turns.append({"role": "candidate", "text": message})
        turns.append({"role": "interviewer", "text": result["reply"]})
        brief = result["brief"]
        if result["done"]:
            break
    return brief


def deterministic_family(answers: list[str], lang: str = "en") -> str:
    brief = deterministic_brief(answers, lang)
    return str(brief.get("roleFamily") or brief.get("role_family") or "software_engineering")


def scenario_from_posting(posting: Posting, lang: str = "en", shape: str = "power_unit") -> dict[str, Any]:
    """One intake_eval scenario grounded in ``posting``."""
    answers = golden_answers_from_jd(posting, shape)
    expect: dict[str, Any] = {"shape": shape}
    if shape == "power_unit":
        expect["max_agent_turns"] = 8
    return {
        "name": slugify(posting.title),
        "behavior": f"jd-grounded {shape} need ({posting.role_family})",
        "lang": lang,
        # What the pipeline classifies from this dialog — the value the
        # role_family invariant is entitled to assert. The posting's own family
        # rides alongside for the report.
        "family": deterministic_family(answers, lang),
        "jd_role_family": posting.role_family,
        "posting_id": posting.id,
        "title": posting.title,
        "company": posting.company,
        # The hard conditions the persona STATES — each must land as its own
        # requirements[] row (L2-NEW-2), which is what arms requirements_captured.
        # EMPTY when the JD states nothing screenable: the check is then not
        # emitted at all rather than passing on a phrase nothing can match.
        "dealbreakers": dealbreakers_from_jd(posting),
        "requestor_prompt": requestor_prompt_from_jd(posting, lang),
        "golden_answers": answers,
        "expect": expect,
    }
