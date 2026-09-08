"""EU AI Act Art. 5(1)(f) — the interview scorecard must never infer emotion.

WHAT THE LAW SAYS. Art. 5(1)(f) of Regulation (EU) 2024/1689 PROHIBITS placing on
the market, putting into service or using AI systems to infer the emotions of a
natural person IN THE AREA OF THE WORKPLACE (and in education), outside the narrow
medical / safety exemption. Hiring is the workplace: a candidate being interviewed
for a job is squarely inside it.

WHY THIS FILE EXISTS RATHER THAN A DOC PARAGRAPH.

  * IN FORCE SINCE 2 FEBRUARY 2025. The Art. 5 prohibitions were the first part of
    the Act to apply — before the high-risk regime, before the GPAI rules.
  * PENALTIES SINCE 2 AUGUST 2025, at the TOP TIER: up to EUR 35 000 000 or 7 % of
    total worldwide annual turnover, whichever is higher. No other breach in the
    Act is priced above it.
  * NO SAFEGUARD CURES IT. Per the Commission's guidelines on prohibited practices
    (C(2025) 884), a prohibited practice is unlawful PER SE. It cannot be rescued
    by human oversight, by a confirmation gate, by candidate consent, by a
    disclosure, or by an accuracy claim — the ordinary high-risk toolkit (Art. 9
    risk management, Art. 14 human oversight) simply does not apply to conduct the
    Act forbids outright. "A recruiter reviews every scorecard" is NOT a defence.

kp is on the right side of that line today for two structural reasons, and only one
of them was pinned by a test before this file:

  1. THE INPUT. The interview feature persists a TRANSCRIPT and never audio, so no
     prosodic signal — pitch, tremor, pause length, vocal energy — ever reaches the
     scorer. This is the strong reason: the analyzer physically cannot hear the
     candidate.
  2. THE INSTRUCTION. `automation.interview_scorecard` tells the model to rate
     substance and not delivery. That reason rests on ONE SENTENCE inside a ~60-line
     f-string, which any prompt edit could have dropped without turning a single
     test red — and on the rubric it ships alongside carrying no affect axis for the
     model to score. This file pins both halves.

So: the tests below are not style checks. They are the standing evidence that the
scorecard asks for competence and never for a read on how the candidate FELT.
Changing either invariant is a legal decision, not a prompt-tuning decision — if a
test here fails, the fix is almost certainly to restore the invariant, not to
update the assertion.
"""
from __future__ import annotations

import json
import string
import unittest
from pathlib import Path

from pipeline.jobfit import automation
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.tests._helpers import mkjob

_RUBRIC_JSON = Path(automation.__file__).with_name("interview-rubrics.json")


class _CaptureProvider:
    """Fake LLM provider: records the prompt it was handed and returns a minimal
    well-formed scorecard payload."""

    def __init__(self) -> None:
        self.prompt: str | None = None

    def complete_json(self, prompt, system=None, expected_keys=None):
        self.prompt = prompt
        return {"ratings": [], "summary": "ok", "recommendation": "hold"}


# ---------------------------------------------------------------------------
# The affect vocabulary.
#
# Written as plain tokens rather than regexes so the list stays readable by
# whoever has to defend it. `_affect_hits` lowercases the text, splits hyphens and
# slashes, strips punctuation and matches term-by-term.
#
# TWO TIERS, because the risk is not the same in both places.
#
#   HARD — unambiguous emotion-inference vocabulary. Prohibited ANYWHERE in a
#   competency: its name, its description, or a behavioural anchor. There is no
#   innocent reason for a hiring rubric to mention prosody, demeanour, mood or
#   body language, and none of these appears in the rubric today.
#
#   AXIS_ONLY — words that read as affect when they NAME A RATED DIMENSION but are
#   ordinary English inside prose. "Confidently explains the tradeoffs" describes
#   the quality of an explanation; a competency CALLED "Confidence" rates how
#   self-assured the candidate seemed, which is an affect judgement. These are
#   therefore checked against competency NAMES only — deliberately, so that a
#   legitimate anchor is never failed for a word choice.
#
# KNOWN BORDERLINE, on the record: `industryAxes.frontline_service` describes
# "Customer-first attitude, composure under pressure, and dependable attendance".
# "composure" and "attitude" sit closest to the line of anything in the tree. They
# are judged permissible here because the axis rates OBSERVABLE CONDUCT under load
# (does the person keep working the queue when it spikes), not an inferred inner
# state, and because no audio or video signal exists from which an emotional state
# could be inferred in the first place. Both words are in AXIS_ONLY, so the moment
# anyone promotes them to a rated dimension of their own — "Composure", "Attitude"
# — this file fails, which is exactly where the judgement should be re-made.
# ---------------------------------------------------------------------------

# (kind, term): "prefix" matches a token by its stem, "exact" matches a whole
# token, "phrase" matches a run of tokens.
HARD_AFFECT_TERMS: tuple[tuple[str, str], ...] = (
    ("prefix", "emotion"),          # emotion, emotions, emotional (incl. "emotional intelligence")
    ("prefix", "sentiment"),
    ("prefix", "mood"),
    ("exact", "affect"),            # exact: "affects the roadmap" is ordinary prose
    ("prefix", "affective"),
    ("prefix", "prosod"),           # prosody, prosodic
    ("prefix", "intonation"),
    ("prefix", "demeano"),          # demeanour, demeanor
    ("prefix", "nerv"),             # nerves, nervous, nervousness
    ("prefix", "anxi"),             # anxiety, anxious
    ("prefix", "enthusias"),        # enthusiasm, enthusiastic
    ("prefix", "charisma"),
    ("prefix", "likeab"),           # likeable, likeability
    ("prefix", "temperament"),
    ("prefix", "personality"),
    ("exact", "warmth"),
    ("exact", "stressed"),
    ("phrase", "stress level"),
    ("phrase", "stress levels"),
    ("phrase", "tone of voice"),
    ("phrase", "vocal tone"),
    ("phrase", "body language"),
    ("phrase", "facial expression"),
    ("phrase", "facial expressions"),
    ("phrase", "eye contact"),
    ("phrase", "energy level"),
    ("phrase", "energy levels"),
    ("phrase", "emotional state"),
)

AXIS_ONLY_AFFECT_TERMS: tuple[tuple[str, str], ...] = (
    ("prefix", "confiden"),         # Confidence / Confident as a RATED AXIS
    ("prefix", "composur"),         # Composure
    ("prefix", "composed"),
    ("prefix", "attitude"),
    ("prefix", "passion"),          # Passion / Passionate
    ("prefix", "positivity"),
    ("prefix", "optimis"),
    ("exact", "calm"),
    ("exact", "poise"),
    ("prefix", "friendli"),         # Friendliness
    ("prefix", "likability"),
    ("phrase", "emotional intelligence"),
)


def _tokens(text: str) -> list[str]:
    """Lowercased word tokens: hyphens and slashes split, punctuation stripped."""
    flat = str(text).lower().replace("-", " ").replace("/", " ")
    return [t for t in (w.strip(string.punctuation) for w in flat.split()) if t]


def _match(text: str, terms) -> list[str]:
    """Every term from `terms` that occurs in `text`."""
    toks = _tokens(text)
    joined = " " + " ".join(toks) + " "
    hits = []
    for kind, term in terms:
        if kind == "exact":
            found = term in toks
        elif kind == "prefix":
            found = any(t.startswith(term) for t in toks)
        else:  # phrase
            found = (" " + term + " ") in joined
        if found:
            hits.append(term)
    return hits


def affect_hits(competency: dict) -> list[str]:
    """Affect vocabulary found in one rubric competency.

    HARD terms are looked for across the whole entry (name + description + every
    behavioural anchor); AXIS_ONLY terms only in the competency's NAME, because
    those words are legitimate inside prose and only become an affect judgement
    when they are the thing being rated.
    """
    name = str(competency.get("competency") or "")
    anchors = competency.get("anchors") or {}
    whole = " ".join(
        [name, str(competency.get("description") or ""), *(str(v) for v in anchors.values())]
    )
    return _match(whole, HARD_AFFECT_TERMS) + _match(name, AXIS_ONLY_AFFECT_TERMS)


def _all_competencies(node, out: list[dict]) -> list[dict]:
    """Every competency object anywhere in the rubric JSON.

    Walked generically rather than by named key, so a NEW rubric family or a new
    industry-axis block is scanned the day it is added instead of the day someone
    remembers to extend this test.
    """
    if isinstance(node, dict):
        if "competency" in node:
            out.append(node)
        else:
            for v in node.values():
                _all_competencies(v, out)
    elif isinstance(node, list):
        for v in node:
            _all_competencies(v, out)
    return out


class ScorecardPromptTest(unittest.TestCase):
    """The no-delivery-scoring instruction must reach the model on every path.

    Asserted against the prompt the provider ACTUALLY receives — not against the
    source of automation.py — so a refactor that moves the sentence is fine and a
    refactor that drops it from one branch is not.
    """

    # The instruction as it ships (automation.py, scorecard prompt). Split at the
    # sentence boundaries so a failure names WHICH clause went missing. A
    # deliberate reword must update these literals in the same change; that is the
    # point of the pin, and the reword should be reviewed as a compliance change.
    RATE_SUBSTANCE = (
        "Rate substance, not delivery: never lower a rating for nerves, hesitation, "
        "filler words, silences, a slow start, or imperfect grammar/accent in a language "
        "that is not the candidate's first."
    )
    HONEST_UNKNOWN = """An honest "I don't know" is not a negative signal."""
    SCORE_THE_RUBRIC = (
        "Score only what a competency's description and its level anchors actually ask for."
    )

    # Each delivery cue the instruction must keep naming. Dropping one silently
    # re-opens that cue for scoring, which is the failure this file exists to catch.
    DELIVERY_CUES = ("nerves", "hesitation", "filler words", "silences", "a slow start", "grammar/accent")

    def _prompt(self, *, archetype: str, role_family: str) -> str:
        candidate = MatchCandidate(
            skills=["Python"],
            seniority="senior",
            role_family=role_family,
            languages=["English"],
            archetype=archetype,
        )
        cap = _CaptureProvider()
        automation.interview_scorecard(candidate, mkjob(), "notes", provider=cap)
        self.assertIsNotNone(cap.prompt, "the scorecard never called the provider")
        return cap.prompt or ""

    def test_instruction_is_in_the_prompt(self) -> None:
        prompt = self._prompt(archetype="bau", role_family="software_engineering")
        self.assertIn(self.RATE_SUBSTANCE, prompt)
        self.assertIn(self.HONEST_UNKNOWN, prompt)
        self.assertIn(self.SCORE_THE_RUBRIC, prompt)

    def test_every_delivery_cue_is_still_named(self) -> None:
        prompt = self._prompt(archetype="bau", role_family="software_engineering")
        for cue in self.DELIVERY_CUES:
            self.assertIn(cue, prompt, f"the scorecard prompt no longer excludes '{cue}' from scoring")

    def test_instruction_survives_every_rubric_variant(self) -> None:
        # The rubric the prompt embeds varies by archetype (experienced vs
        # early_career) and by role-family (industry axes appended). The fairness
        # clause is not part of that variation and must appear on all of them.
        families = ["software_engineering", *automation.INDUSTRY_AXES]
        for archetype in ("bau", "student", "career_switcher", None):
            for family in families:
                with self.subTest(archetype=archetype, role_family=family):
                    prompt = self._prompt(archetype=archetype or "", role_family=family)
                    self.assertIn(self.RATE_SUBSTANCE, prompt)

    def test_the_prompt_asks_only_for_the_fixed_rubric(self) -> None:
        # The counterpart to the instruction: the model is told the competency list
        # is closed. Without this, "rate substance not delivery" is advice; with it,
        # an invented "Confidence" axis is off-contract.
        prompt = self._prompt(archetype="bau", role_family="frontline_service")
        self.assertIn("do NOT invent or omit any", prompt)


class RubricHasNoAffectAxisTest(unittest.TestCase):
    """No shipped competency may rate an emotional state.

    The prompt instruction above is the model's *guidance*; the rubric is the model's
    *task list*. An affect axis in the rubric would make emotion inference the
    scorecard's explicit purpose — the clearest possible Art. 5(1)(f) breach — and
    would do it while the fairness sentence still sat in the prompt looking correct.
    """

    def setUp(self) -> None:
        self.data = json.loads(_RUBRIC_JSON.read_text(encoding="utf-8"))
        self.competencies = _all_competencies(self.data, [])

    def test_the_scan_actually_sees_the_shipped_rubric(self) -> None:
        # Guard against a vacuous pass: if the walk stopped finding competencies,
        # every assertion below would be trivially true.
        self.assertGreaterEqual(len(self.competencies), 17, "rubric walk found too few competencies")
        names = {c["competency"] for c in self.competencies}
        for expected in ("Technical depth", "Coachability", "Service orientation & reliability"):
            self.assertIn(expected, names)

    def test_no_competency_carries_affect_vocabulary(self) -> None:
        offenders = {
            c["competency"]: hits for c in self.competencies if (hits := affect_hits(c))
        }
        self.assertEqual(
            offenders,
            {},
            "AI Act Art. 5(1)(f): a scorecard competency now rates affect/emotion — "
            f"{offenders}. This is a prohibited practice, not a tunable: no human "
            "review, disclosure or consent makes it lawful.",
        )

    def test_rating_anchors_are_not_affect_scaled(self) -> None:
        # The 1-5 scale labels are shared by every competency; an affect word here
        # would colour all of them at once.
        for level, label in self.data["ratingAnchors"].items():
            with self.subTest(level=level):
                self.assertEqual(_match(label, HARD_AFFECT_TERMS), [])

    def test_the_vocabulary_actually_bites(self) -> None:
        # The assertion above is only worth its runtime if the vocabulary catches a
        # real affect axis. These are the shapes it must reject.
        hostile = [
            {
                "competency": "Emotional composure",
                "description": "How calm and settled the candidate stays under questioning.",
            },
            {
                "competency": "Presence",
                "description": "Read the candidate's mood and energy level from the transcript.",
            },
            {
                "competency": "Delivery",
                "description": "Assess tone of voice, body language and eye contact.",
            },
            {
                "competency": "Confidence",
                "description": "How self-assured the answers sound.",
            },
            {
                "competency": "Resilience",
                "description": "Structured recovery after a setback.",
                "anchors": {"1": "Visibly nervous and unable to continue.", "5": "Recovers cleanly."},
            },
        ]
        for entry in hostile:
            with self.subTest(competency=entry["competency"]):
                self.assertTrue(
                    affect_hits(entry),
                    f"the affect vocabulary failed to catch {entry['competency']!r} — it has "
                    "become decorative and no longer protects anything",
                )

    def test_the_vocabulary_does_not_bite_legitimate_competencies(self) -> None:
        # The other half of the calibration: a rubric may rate communication, and an
        # anchor may use "confidently" or "composed" as ordinary prose about the
        # quality of an answer. Those must pass, or the gate gets disabled by whoever
        # meets it next.
        benign = [
            {
                "competency": "Communication",
                "description": "Clarity, structure, and active listening.",
            },
            {
                "competency": "Conceptual depth",
                "description": "Whether they understand why, not just what.",
                "anchors": {
                    "4": "Confidently states which tradeoff they would take and why.",
                    "5": "Gives a composed, evidence-backed account of where the idea breaks.",
                },
            },
            {
                "competency": "Service orientation & reliability",
                "description": (
                    "Customer-first attitude, composure under pressure, and dependable "
                    "attendance and follow-through."
                ),
            },
        ]
        for entry in benign:
            with self.subTest(competency=entry["competency"]):
                self.assertEqual(affect_hits(entry), [], f"false positive on {entry['competency']!r}")


if __name__ == "__main__":
    unittest.main()
