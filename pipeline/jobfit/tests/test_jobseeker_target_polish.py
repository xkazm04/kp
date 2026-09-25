"""CV studio tailored toward the seeker's STATED target (lot A2.3).

A career changer's CV has to be reframed toward where they are going: lead with the
target-relevant work, move it up, name what transfers, flag the gap honestly. The
contract under test is the one the studio already holds for every suggestion —
GROUNDED, never invented: each ``before`` occurs verbatim in the source, the only CV
text a template carries is a verbatim source line, and no number appears that the CV
does not contain. Keyless is the load-bearing path; the persona gains the same
instruction plus the hard rule, and the grounding filter still drops an invented
``before`` from a model's answer."""

from __future__ import annotations

import re
import unittest

from pipeline.jobfit.jobseeker import (
    CV_POLISH_PROMPT_VERSION,
    cv_polish_system_brief,
    deterministic_suggestions,
    deterministic_turn,
    opening_turn,
    run_turn,
    target_suggestion_plan,
    target_suggestions,
)
from pipeline.jobfit.profile import CandidateProfileV2
from pipeline.jobfit.tests.devcase_fakes import TextReply

ANALYST_TO_AI = """Petr Novák
Praha · petr@example.com

Profile
IT business analyst with eight years in banking systems. Detail-oriented and results-driven team player.

Experience
2024–2025 AI Consultant, Nova AI s.r.o.
Built LLM assistants with RAG and prompt engineering in Python.
2016–2024 IT Business Analyst, Banka a.s.
Requirements analysis and UML models for core banking.
2014–2016 QA Engineer, Soft s.r.o.
Test automation with Selenium.

Skills
Python, SQL, UML, Selenium
"""

PROFILE = {
    "displayName": "Petr Novák",
    "roleFamily": "product_project",
    "languages": ["Czech", "English"],
    "yearsExperience": 9,
    "skillClaims": [{"skill": "Python", "level": "strong", "provenance": "professional"}],
}

TARGET = "AI Engineer"
_QUOTED = re.compile(r"[“„«]\s?(.+?)\s?[”“»]")
_NUMBER = re.compile(r"\d+")


def _req(**over):
    base = {
        "kind": "cv_polish", "lang": "en", "profile": PROFILE, "preferences": {},
        "cvSourceText": ANALYST_TO_AI, "artifact": None, "transcript": [], "message": None,
    }
    base.update(over)
    return base


class GroundingMixin(unittest.TestCase):
    def assert_grounded(self, suggestions: list[dict], source: str) -> None:
        for s in suggestions:
            self.assertIn(s["before"], source, "before must be the seeker's own sentence")
            for fact in _QUOTED.findall(s["after"]):
                self.assertIn(fact, source, f"quoted fact not in the CV: {fact!r}")
            for number in _NUMBER.findall(s["after"] + " " + s["why"]):
                self.assertIn(number, source, f"a number the CV does not contain: {number}")


class KeylessTargetSuggestionsTest(GroundingMixin):
    def test_analyst_to_ai_gets_target_aware_grounded_suggestions(self) -> None:
        out = target_suggestions(ANALYST_TO_AI, "en", TARGET)
        self.assertTrue(out)
        self.assertTrue(all(TARGET in s["after"] for s in out))
        self.assert_grounded(out, ANALYST_TO_AI)
        kinds = [k for k, _b, _p in target_suggestion_plan(ANALYST_TO_AI, TARGET)]
        # The summary opens with the analyst years while the CV holds AI work: lead with it.
        self.assertEqual(kinds[0], "lead")
        lead = out[0]
        self.assertEqual(lead["before"], "IT business analyst with eight years in banking systems.")
        self.assertIn("2024–2025 AI Consultant, Nova AI s.r.o.", lead["after"])
        # Analysis and QA work are named as what transfers — framing, not new skills.
        self.assertIn("transfer", kinds)
        self.assertNotIn("gap", kinds)

    def test_four_locales(self) -> None:
        for lang in ("en", "cs", "de", "fr"):
            out = target_suggestions(ANALYST_TO_AI, lang, TARGET)
            self.assertTrue(out, lang)
            self.assert_grounded(out, ANALYST_TO_AI)
            for s in out:
                self.assertIn(TARGET, s["after"], lang)
                self.assertTrue(s["section"] and s["why"], lang)

    def test_target_line_below_the_past_is_moved_up(self) -> None:
        cv = (
            "Eva Malá\n\nExperience\n2016–2025 Business Analyst, Banka a.s.\n"
            "Stakeholder workshops for payments.\nMachine learning pilot for fraud scoring.\n"
        )
        plan = target_suggestion_plan(cv, TARGET)
        self.assertIn(("move_up", "Machine learning pilot for fraud scoring.", {}), plan)
        self.assert_grounded(target_suggestions(cv, "en", TARGET), cv)

    def test_no_target_work_flags_the_gap_honestly(self) -> None:
        cv = "Jan Dvořák\n\nProfile\nAccountant with six years in audit.\n\nExperience\n2019–2025 Accountant, Firma a.s.\n"
        out = target_suggestions(cv, "en", TARGET)
        self.assertEqual([k for k, _b, _p in target_suggestion_plan(cv, TARGET)], ["gap"])
        self.assertEqual(out[0]["before"], "Accountant with six years in audit.")
        self.assert_grounded(out, cv)

    def test_no_target_changes_nothing(self) -> None:
        profile = CandidateProfileV2()
        base = deterministic_suggestions(ANALYST_TO_AI, profile, "en")
        self.assertEqual(deterministic_suggestions(ANALYST_TO_AI, profile, "en", None), base)
        self.assertFalse(any(TARGET in s["after"] for s in base))
        self.assertEqual(target_suggestions(ANALYST_TO_AI, "en", "  "), [])


class DialogTargetSuggestionsTest(GroundingMixin):
    def test_stored_target_tailors_the_opening_sheet(self) -> None:
        result = opening_turn(_req(preferences={"targetTitles": [TARGET]}))
        suggestions = result["artifact"]["suggestions"]
        self.assertTrue(any(TARGET in s["after"] for s in suggestions))
        self.assert_grounded(suggestions, ANALYST_TO_AI)

    def test_target_stated_in_the_dialog_reaches_the_sheet(self) -> None:
        turns: list[dict] = []
        result = opening_turn(_req())
        self.assertFalse(any(TARGET in s["after"] for s in result["artifact"]["suggestions"]))
        artifact = result["artifact"]
        turns.append({"role": "interviewer", "text": result["reply"]})
        for answer in ("Praha", "60 000 Kč měsíčně", TARGET):
            result = deterministic_turn(_req(transcript=turns, message=answer, artifact=artifact))
            turns += [{"role": "candidate", "text": answer}, {"role": "interviewer", "text": result["reply"]}]
            artifact = result["artifact"]
        self.assertEqual(result["promptVersion"], CV_POLISH_PROMPT_VERSION)
        tailored = [s for s in artifact["suggestions"] if TARGET in s["after"]]
        self.assertTrue(tailored)
        self.assert_grounded(artifact["suggestions"], ANALYST_TO_AI)
        # An applied target suggestion leaves the sheet and does not come back.
        section = tailored[0]["section"]
        prefs = {"targetTitles": [TARGET]}
        result = deterministic_turn(_req(preferences=prefs, transcript=turns, message=f"Apply suggestion: {section}", artifact=artifact))
        self.assertNotIn(tailored[0]["before"], result["artifact"]["cvMarkdown"])
        self.assertNotIn(tailored[0]["before"], [s["before"] for s in result["artifact"]["suggestions"]])


class PersonaTailoringTest(unittest.TestCase):
    def test_brief_tailors_to_the_first_target_with_the_hard_rule(self) -> None:
        brief = cv_polish_system_brief("en", TARGET)
        self.assertIn('"AI Engineer"', brief)
        self.assertIn("TAILORING", brief)
        self.assertIn("never add a skill, employer, date, number or responsibility", brief)
        self.assertNotIn("TAILORING", cv_polish_system_brief("en"))

    def test_model_answer_is_still_grounded_and_the_brief_carries_the_target(self) -> None:
        payload = {
            "reply": "Let's lead with your AI work.",
            "done": False,
            "artifact": {
                "cvMarkdown": "# Petr Novák",
                "preferences": {},
                "unreadable": [],
                "suggestions": [
                    {"section": "Summary", "before": "IT business analyst with eight years in banking systems.",
                     "after": "AI consultant building LLM assistants, after eight years of analysis.", "why": "target"},
                    {"section": "Experience", "before": "Shipped a PyTorch model serving 10M users.",
                     "after": "Invented.", "why": "not in the CV"},
                ],
            },
        }
        fake = TextReply(payload)
        opening = opening_turn(_req())
        turns = [{"role": "interviewer", "text": opening["reply"]}]
        result = run_turn(fake, _req(preferences={"targetTitles": [TARGET, "ML Engineer"]}, transcript=turns, message="hello", artifact=opening["artifact"]))
        self.assertEqual(result["source"], "llm")
        befores = [s["before"] for s in result["artifact"]["suggestions"]]
        self.assertEqual(befores, ["IT business analyst with eight years in banking systems."])
        _prompt, system, _keys = fake.calls[-1]
        self.assertIn('"AI Engineer"', system)
        self.assertIn("HARD RULE", system)


if __name__ == "__main__":
    unittest.main()
