"""Role-intake dialog engine (Phase 1) — deterministic path, merge, triage.

The keyless contract is the load-bearing one (graceful degradation is a
product property): a full scripted dialog must fill a RoleBrief with
provenance 'stated' end to end and close with a read-back. The merge rules
protect accumulated state from an LLM that forgets fields; the shape triage
implements the research doc's power-unit fast path."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest

from pipeline.jobfit.intake import (
    INTAKE_PROMPT_VERSION,
    deterministic_turn,
    detect_shape,
    intake_system_brief,
    merge_brief,
    opening_turn,
    run_intake_turn,
)
from pipeline.jobfit.rolebrief import BriefFacet, BriefRequirement, RoleBrief, coerce_role_brief


def _drive(answers: list[str], lang: str = "en") -> tuple[list[dict], dict]:
    """Drive the deterministic script: opener, then each answer in turn."""
    turns: list[dict] = []
    opener = opening_turn(lang)
    turns.append({"role": "interviewer", "text": opener["reply"]})
    brief = coerce_role_brief(opener["brief"])
    result = opener
    for answer in answers:
        result = deterministic_turn(turns, brief, answer, lang)
        turns.append({"role": "candidate", "text": answer})
        turns.append({"role": "interviewer", "text": result["reply"]})
        brief = coerce_role_brief(result["brief"])
        if result["done"]:
            break
    return turns, result


class DeterministicScriptTest(unittest.TestCase):
    def test_full_story_dialog_fills_brief_and_closes(self) -> None:
        answers = [
            "We think we need someone for the data side, not sure exactly — reporting keeps slipping",  # context (story markers)
            "Data Analyst",
            "Owns the weekly reporting; dashboards nobody has to babysit",
            "SQL\nPython",
            "dbt",
            "senior, I think",
            "Czech, English",
            "Team of 4, reports to the head of data",
            "Another quarter of manual reports and we lose the ops team's trust",
            "skip",
        ]
        _turns, result = _drive(answers)
        self.assertTrue(result["done"])
        brief = coerce_role_brief(result["brief"])
        self.assertEqual(brief.title, "Data Analyst")
        self.assertEqual(brief.seniority, "senior")
        musts = [r for r in brief.requirements if r.kind == "must_have"]
        nices = [r for r in brief.requirements if r.kind == "nice_to_have"]
        self.assertEqual({r.skill for r in musts}, {"SQL", "Python"})
        self.assertEqual([r.skill for r in nices], ["dbt"])
        self.assertTrue(all(r.provenance == "stated" for r in brief.requirements))
        self.assertTrue(brief.success_criteria)
        self.assertIn("Czech", brief.languages)
        facet_keys = {f.key for f in brief.facets}
        self.assertLessEqual({"why_now", "team_context", "urgency"}, facet_keys)
        # Skipped budget leaves no facet — a skip is not data.
        self.assertNotIn("budget_band", facet_keys)
        # The close is a read-back with the END sentinel.
        self.assertIn("<<END>>", result["reply"])
        self.assertIn("Data Analyst", result["reply"])

    def test_power_unit_dialog_is_short(self) -> None:
        answers = [
            "Backfill — Jarda left, we need the same again for the payments squad",
            "Java Developer",
            "Takes over Jarda's services; on-call rotation runs without gaps",
            "Java, Spring",
            "senior",
            "skip",
        ]
        turns, result = _drive(answers)
        self.assertTrue(result["done"])
        self.assertEqual(result["shape"], "power_unit")
        # Short path: opener + 5 questions + read-back ⇒ well under the story script.
        agent_turns = [t for t in turns if t["role"] == "interviewer"]
        self.assertLessEqual(len(agent_turns), 7)

    def test_czech_script_localizes(self) -> None:
        opener = opening_turn("cs")
        self.assertIn("Pojďme", opener["reply"])
        turns = [{"role": "interviewer", "text": opener["reply"]}]
        result = deterministic_turn(turns, RoleBrief(), "hledáme posilu do backendu", "cs")
        self.assertIn("nazvali", result["reply"])  # the cs title question

    def test_opening_is_deterministic_and_nonjudgmental(self) -> None:
        opener = opening_turn("en")
        self.assertEqual(opener["source"], "deterministic")
        self.assertIn("no wrong answers", opener["reply"])


class ShapeTriageTest(unittest.TestCase):
    def test_backfill_markers_yield_power_unit(self) -> None:
        turns = [{"role": "candidate", "text": "This is a backfill for the same role as the old JD"}]
        self.assertEqual(detect_shape(turns), "power_unit")

    def test_hedging_yields_story(self) -> None:
        turns = [{"role": "candidate", "text": "We think we maybe need someone, not sure what level"}]
        self.assertEqual(detect_shape(turns), "story")

    def test_undecided_defaults_to_story_after_two_turns(self) -> None:
        turns = [
            {"role": "candidate", "text": "Hello"},
            {"role": "candidate", "text": "It concerns the platform group"},
        ]
        self.assertEqual(detect_shape(turns), "story")
        self.assertIsNone(detect_shape(turns[:1]))


class MergeBriefTest(unittest.TestCase):
    def test_update_cannot_drop_stated_requirements(self) -> None:
        base = RoleBrief(
            title="Data Analyst",
            seniority="senior",
            requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated", confidence=0.9)],
            facets=[BriefFacet(key="urgency", value="critical", provenance="stated", confidence=0.9)],
        )
        update = RoleBrief(requirements=[BriefRequirement(skill="Python", kind="must_have", provenance="inferred")])
        merged = merge_brief(base, update)
        self.assertEqual({r.skill for r in merged.requirements}, {"SQL", "Python"})
        self.assertEqual(merged.title, "Data Analyst")  # empty update title keeps base
        self.assertEqual(merged.seniority, "senior")  # default-medior update can't regress
        self.assertEqual(merged.facets[0].value, "critical")

    def test_stated_grading_never_regresses_to_inferred(self) -> None:
        base = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated", confidence=0.9)])
        update = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="nice_to_have", provenance="inferred")])
        merged = merge_brief(base, update)
        self.assertEqual(merged.requirements[0].kind, "must_have")
        self.assertEqual(merged.requirements[0].provenance, "stated")

    def test_stated_update_can_revise_stated_base(self) -> None:
        base = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated")])
        update = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="nice_to_have", provenance="stated")])
        merged = merge_brief(base, update)
        self.assertEqual(merged.requirements[0].kind, "nice_to_have")  # the requestor demoted it

    def test_merge_stamps_prompt_version(self) -> None:
        merged = merge_brief(RoleBrief(), RoleBrief())
        self.assertEqual(merged.prompt_version, INTAKE_PROMPT_VERSION)


class RunIntakeTurnTest(unittest.TestCase):
    def test_no_provider_uses_deterministic_with_source(self) -> None:
        turns = [{"role": "interviewer", "text": opening_turn("en")["reply"]}]
        result = run_intake_turn(None, turns, None, "we need a backfill, same as before", lang="en")
        self.assertEqual(result["source"], "deterministic")
        self.assertFalse(result["done"])
        self.assertTrue(result["reply"])

    def test_llm_end_requires_sentinel(self) -> None:
        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                return {"reply": "Great, we're done.", "brief": {}, "shape": "story", "done": True}

        result = run_intake_turn(FakeProvider(), [], None, "hello", lang="en")
        self.assertEqual(result["source"], "llm")
        self.assertFalse(result["done"])  # done=true without <<END>> is not a close

    def test_system_brief_carries_the_register(self) -> None:
        brief = intake_system_brief("en")
        for marker in ("coaching session, not an interrogation", "ONE question per turn", "90 days", "<<END>>", "stated"):
            self.assertIn(marker, brief)


class CliSmokeTest(unittest.TestCase):
    def test_opening_and_no_llm_turn(self) -> None:
        out = subprocess.run(
            [sys.executable, "-m", "pipeline.jobfit.intake_cli", "--opening", "--lang", "en"],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        opening = json.loads(out.stdout)
        self.assertIn("reply", opening)
        self.assertEqual(opening["source"], "deterministic")


if __name__ == "__main__":
    unittest.main()
