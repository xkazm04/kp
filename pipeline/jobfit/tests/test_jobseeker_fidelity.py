"""The CV studio's fidelity contract — every model rewrite is screened before it can reach a CV.

registry recruiting/cv-content-construction/machine-rewrite-fidelity-contract: an
instruction not to invent is a soft control; the contract is enforced AFTER the model,
against the record, and closed by the owner. A fake provider that invents the three
fabrications the technique's evidence names (an upgraded metric, an inflated role, a
skill borrowed from the job ad) plus an invented employer proves each is caught; a whole
regenerated CV is read as line proposals and never adopted; a question can never be
applied; and a fact the SEEKER states in the dialog is part of the record."""

from __future__ import annotations

import unittest

from pipeline.jobfit.jobseeker import (
    _Record,
    deterministic_turn,
    opening_turn,
    run_turn,
    screen_rewrite,
)
from pipeline.jobfit.tests.devcase_fakes import TextReply

# SYNTHETIC — nobody real.
SOURCE = """Eva Malá
Brno · eva@example.invalid

Profile
Data analyst with six years in retail reporting.

Experience
2020–2025 Data Analyst, Retail Co a.s.
Responsible for the weekly sales report.
Built a Python script that cleans store data.
Cut report preparation from five days to two.

Skills
Python, SQL, Excel
"""

PROFILE = {
    "displayName": "Eva Malá",
    "roleFamily": "data_analytics",
    "languages": ["Czech", "English"],
    "yearsExperience": 6,
    "skillClaims": [{"skill": "Python", "level": "strong", "provenance": "professional"}],
}

REPORT = "Responsible for the weekly sales report."
SCRIPT = "Built a Python script that cleans store data."
CUT = "Cut report preparation from five days to two."
SUMMARY = "Data analyst with six years in retail reporting."


def _req(**over):
    base = {
        "kind": "cv_polish", "lang": "en", "profile": PROFILE, "preferences": {"targetTitles": ["AI Engineer"]},
        "cvSourceText": SOURCE, "artifact": None, "transcript": [], "message": None,
    }
    base.update(over)
    return base


def _model_turn(suggestions, cv_markdown="", message="Any ideas for my experience?", transcript=None):
    payload = {
        "reply": "Here are a few rewrites.",
        "done": False,
        "artifact": {"cvMarkdown": cv_markdown, "preferences": {}, "unreadable": [], "suggestions": suggestions},
    }
    opening = opening_turn(_req())
    turns = transcript if transcript is not None else [{"role": "interviewer", "text": opening["reply"]}]
    result = run_turn(TextReply(payload), _req(transcript=turns, message=message, artifact=opening["artifact"]))
    return opening, result


def _by_before(result):
    return {s["before"]: s for s in result["artifact"]["suggestions"]}


class ScreenRewriteTest(unittest.TestCase):
    record = _Record(SOURCE)

    def test_a_faithful_rewrite_passes(self) -> None:
        self.assertEqual(screen_rewrite(SCRIPT, "Wrote a Python script that cleans store data.", self.record), ("ok", None))
        # Casing a name the record holds is a tidy, not an addition ("python" -> Python).
        self.assertEqual(screen_rewrite(CUT, "Cut report preparation from 5 days to 2.", self.record)[0], "ok")

    def test_an_invented_metric_becomes_a_question(self) -> None:
        verdict, detail = screen_rewrite(REPORT, "Produced the weekly sales report, saving 30% of analyst time.", self.record)
        self.assertEqual((verdict, detail), ("question", "number:"))

    def test_an_invented_employer_is_dropped(self) -> None:
        verdict, detail = screen_rewrite(SCRIPT, "Built a Python script at Google that cleans store data.", self.record)
        self.assertEqual(verdict, "drop")
        self.assertEqual(detail, "proper_noun:Google")

    def test_a_skill_from_the_ad_becomes_a_question(self) -> None:
        verdict, detail = screen_rewrite(SCRIPT, "Built a Python and machine learning script that cleans store data.", self.record, "AI Engineer")
        self.assertEqual((verdict, detail), ("question", "term:Machine learning"))
        # An ad term that is not capitalised is caught all the same (it is not a proper noun).
        self.assertEqual(screen_rewrite(SCRIPT, "Built a Python script with embeddings that cleans store data.", self.record)[0], "question")

    def test_a_raised_verb_or_title_becomes_a_question(self) -> None:
        self.assertEqual(screen_rewrite(REPORT, "Owned the weekly sales report.", self.record), ("question", "raise:Owned"))
        self.assertEqual(screen_rewrite(SUMMARY, "Senior data analyst with six years in retail reporting.", self.record), ("question", "raise:Senior"))
        # A verb the line already carries is not a raise.
        self.assertEqual(screen_rewrite("Led the weekly sales report.", "Led the weekly sales reporting.", self.record)[0], "ok")

    def test_a_self_descriptor_is_dropped(self) -> None:
        verdict, detail = screen_rewrite(SUMMARY, "Results-driven data analyst with six years in retail reporting.", self.record)
        self.assertEqual((verdict, detail), ("drop", "descriptor:results-driven"))

    def test_a_less_specific_line_is_dropped(self) -> None:
        self.assertEqual(screen_rewrite(SCRIPT, "Built a script that cleans store data.", self.record), ("drop", "generalised:specifics"))
        self.assertEqual(screen_rewrite("Modelled 30 processes in UML.", "Modelled processes in UML.", _Record("Modelled 30 processes in UML.")), ("drop", "generalised:number"))

    def test_a_fact_the_seeker_stated_in_the_dialog_is_part_of_the_record(self) -> None:
        owner = _Record(SOURCE, "It saved about 30% of the analysts' time.")
        self.assertEqual(screen_rewrite(REPORT, "Produced the weekly sales report, saving 30% of analyst time.", owner)[0], "ok")


class ModelTurnTest(unittest.TestCase):
    def test_every_fabrication_the_fake_invents_is_caught(self) -> None:
        _opening, result = _model_turn([
            {"section": "Experience", "before": REPORT, "after": "Owned the weekly sales report for 40 stores.", "why": "stronger"},
            {"section": "Experience", "before": SCRIPT, "after": "Built a Python script at Google that cleans store data.", "why": "brand"},
            {"section": "Summary", "before": SUMMARY, "after": "Data analyst with six years in retail reporting and PyTorch.", "why": "target"},
            {"section": "Experience", "before": CUT, "after": "Cut report preparation from 5 days to 2.", "why": "digits"},
        ])
        self.assertEqual(result["source"], "llm")
        got = _by_before(result)
        # The metric AND the raised verb: the line becomes a question, never the model's words.
        self.assertEqual(got[REPORT]["kind"], "question")
        self.assertNotIn("40", got[REPORT]["after"])
        self.assertNotIn("Owned", got[REPORT]["after"])
        # The invented employer is dropped outright.
        self.assertNotIn(SCRIPT, got)
        # The skill borrowed from the ad is asked about, by name.
        self.assertEqual(got[SUMMARY]["kind"], "question")
        self.assertIn("PyTorch", got[SUMMARY]["after"])
        # The faithful one survives as a rewrite.
        self.assertEqual(got[CUT]["kind"], "rewrite")
        self.assertEqual(got[CUT]["after"], "Cut report preparation from 5 days to 2.")

    def test_a_whole_regenerated_cv_is_proposals_never_the_sheet(self) -> None:
        redraft = "\n".join([
            "# Eva Malá",
            "Brno · eva@example.invalid",
            "",
            "## Summary",
            "- Senior AI engineer at DeepMind with ten years of machine learning.",
            "",
            "## Experience",
            "- 2020–2025 Data Analyst, Retail Co a.s.",
            "- Produced the weekly sales report.",
            "- Built a Python script that cleans store data.",
            "- Cut report preparation from five days to two.",
            "- Shipped a Kubernetes platform serving 10M users.",
        ])
        opening, result = _model_turn([], cv_markdown=redraft)
        # The sheet is the seeker's own reflowed CV, untouched by the redraft.
        self.assertEqual(result["artifact"]["cvMarkdown"], opening["artifact"]["cvMarkdown"])
        self.assertNotIn("DeepMind", result["artifact"]["cvMarkdown"])
        self.assertNotIn("Kubernetes", result["artifact"]["cvMarkdown"])
        got = _by_before(result)
        # A replaced line became a proposal and passed the screen.
        self.assertEqual(got[REPORT]["after"], "Produced the weekly sales report.")
        self.assertEqual(got[REPORT]["kind"], "rewrite")
        # The invented summary is not a rewrite; the invented added line is nothing at all.
        self.assertNotEqual(got.get(SUMMARY, {}).get("kind"), "rewrite")
        self.assertFalse(any("Kubernetes" in s["after"] and s["kind"] == "rewrite" for s in result["artifact"]["suggestions"]))
        for s in result["artifact"]["suggestions"]:
            self.assertIn(s["before"], SOURCE)

    def test_apply_on_the_model_path_is_deterministic_and_never_takes_the_redraft(self) -> None:
        opening = opening_turn(_req())
        artifact = {**opening["artifact"], "suggestions": [
            {"section": "Experience", "before": REPORT, "after": "Produced the weekly sales report.", "why": "active", "kind": "rewrite"},
        ]}
        payload = {"reply": "Done.", "done": False, "artifact": {"cvMarkdown": "# Someone else\n- Invented everything.", "preferences": {}, "unreadable": [], "suggestions": []}}
        turns = [{"role": "interviewer", "text": opening["reply"]}]
        result = run_turn(TextReply(payload), _req(transcript=turns, message="Apply suggestion: Experience", artifact=artifact))
        md = result["artifact"]["cvMarkdown"]
        self.assertIn("Produced the weekly sales report.", md)
        self.assertNotIn(REPORT, md)
        self.assertNotIn("Someone else", md)
        self.assertNotIn("Invented everything", md)


class StoredSuggestionsTest(unittest.TestCase):
    def test_a_stored_unscreened_rewrite_is_screened_again_and_a_question_is_never_applied(self) -> None:
        opening = opening_turn(_req())
        # A row written before the screen existed: an invented number, no `kind`.
        artifact = {**opening["artifact"], "suggestions": [
            {"section": "Experience", "before": REPORT, "after": "Produced the weekly sales report for 40 stores.", "why": "old"},
        ]}
        turns = [{"role": "interviewer", "text": opening["reply"]}]
        result = deterministic_turn(_req(transcript=turns, message="Apply suggestion: Experience", artifact=artifact))
        self.assertIn(REPORT, result["artifact"]["cvMarkdown"])
        self.assertNotIn("40 stores", result["artifact"]["cvMarkdown"])
        self.assertEqual(result["artifact"]["suggestions"][0]["kind"], "question")
        self.assertIn("question for you", result["reply"])

    def test_a_question_that_lost_its_kind_on_the_way_is_still_a_question(self) -> None:
        _opening, first = _model_turn([
            {"section": "Experience", "before": REPORT, "after": "Produced the weekly sales report for 40 stores.", "why": "x"},
        ])
        question = _by_before(first)[REPORT]
        stripped = {k: v for k, v in question.items() if k != "kind"}
        opening = opening_turn(_req())
        turns = [{"role": "interviewer", "text": opening["reply"]}]
        result = deterministic_turn(_req(transcript=turns, message="Apply suggestion: Experience", artifact={**opening["artifact"], "suggestions": [stripped]}))
        self.assertIn(REPORT, result["artifact"]["cvMarkdown"])
        self.assertEqual(result["artifact"]["suggestions"][0]["kind"], "question")

    def test_every_keyless_suggestion_is_a_question(self) -> None:
        result = opening_turn(_req())
        self.assertTrue(result["artifact"]["suggestions"])
        for s in result["artifact"]["suggestions"]:
            self.assertEqual(s["kind"], "question")
            self.assertIn(s["before"], SOURCE)


if __name__ == "__main__":
    unittest.main()
