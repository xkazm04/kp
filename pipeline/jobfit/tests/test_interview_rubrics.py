"""Contract tests for the interview scorecard rubrics.

The rubrics live in ONE place — pipeline/jobfit/interview-rubrics.json — read
directly by both the Python scorer (automation.py) and the recruiter compare
grid (app/_lib/interview-rubric.ts). That single-source design (same as
archetypes.json / archetypes.ts) makes the hand-mirror drift the old
test_rubric_parity guarded against structurally impossible, so these tests
instead pin the *shape* the scorer and the UI depend on: both scoringModel
rubrics exist, the early-career rubric is fully behaviorally-anchored, every
archetype's scoring model has a rubric to score it, and archetype -> rubric
selection lines up with the experienced/early-career split.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.jobfit import automation, registry

_JSON = Path(automation.__file__).with_name("interview-rubrics.json")


class TestInterviewRubrics(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(_JSON.exists(), f"rubric source not found at {_JSON}")
        self.data = json.loads(_JSON.read_text(encoding="utf-8"))

    def test_automation_reads_the_json_source(self) -> None:
        # The scorer must load the JSON, not a hand-written literal.
        self.assertEqual(automation.INTERVIEW_RUBRICS, self.data["rubrics"])
        self.assertEqual(
            automation.RATING_ANCHORS,
            {int(k): v for k, v in self.data["ratingAnchors"].items()},
        )

    def test_rating_anchors_cover_1_to_5(self) -> None:
        self.assertEqual(set(automation.RATING_ANCHORS), {1, 2, 3, 4, 5})

    def test_experienced_alias_is_the_experienced_rubric(self) -> None:
        # The historical flat rubric name still resolves to the experienced axes.
        self.assertEqual(automation.INTERVIEW_RUBRIC, automation.INTERVIEW_RUBRICS["experienced"])

    def test_every_scoring_model_has_a_rubric(self) -> None:
        archetypes = json.loads(
            Path(registry.__file__).with_name("archetypes.json").read_text(encoding="utf-8")
        )["archetypes"]
        models = {a["scoringModel"] for a in archetypes}
        missing = models - set(automation.INTERVIEW_RUBRICS)
        self.assertFalse(missing, f"no scorecard rubric for scoring model(s): {missing}")

    def test_every_competency_has_name_and_description(self) -> None:
        for model, rubric in automation.INTERVIEW_RUBRICS.items():
            self.assertTrue(rubric, f"{model} rubric is empty")
            for c in rubric:
                self.assertTrue(c.get("competency"), f"{model}: a competency is missing its name")
                self.assertTrue(
                    c.get("description"), f"{model}: '{c.get('competency')}' is missing a description"
                )

    def test_early_career_is_behaviorally_anchored(self) -> None:
        rubric = automation.INTERVIEW_RUBRICS["early_career"]
        self.assertGreaterEqual(len(rubric), 6, "early-career rubric should cover the 6 potential constructs")
        for c in rubric:
            anchors = c.get("anchors")
            self.assertIsInstance(anchors, dict, f"early_career '{c['competency']}' has no BARS anchors")
            self.assertEqual(
                {str(k) for k in anchors},
                {"1", "2", "3", "4", "5"},
                f"early_career '{c['competency']}' anchors must cover levels 1-5",
            )
            for level, text in anchors.items():
                self.assertTrue(str(text).strip(), f"early_career '{c['competency']}' anchor {level} is empty")

    def test_experienced_has_no_per_level_anchors(self) -> None:
        # Keeps the experienced scorecard prompt byte-identical to its history.
        for c in automation.INTERVIEW_RUBRICS["experienced"]:
            self.assertNotIn("anchors", c, f"experienced '{c['competency']}' unexpectedly carries BARS anchors")

    def test_rubric_selection_by_archetype(self) -> None:
        self.assertEqual(automation.rubric_for_archetype("bau"), automation.INTERVIEW_RUBRICS["experienced"])
        early = registry.early_career_archetypes()
        self.assertTrue(early, "expected at least one early-career archetype in the registry")
        for arch in early:
            self.assertEqual(
                automation.rubric_for_archetype(arch),
                automation.INTERVIEW_RUBRICS["early_career"],
                f"early-career archetype '{arch}' should select the early_career rubric",
            )
        # Unknown / None falls back to experienced, matching the scorecard default.
        self.assertEqual(automation.rubric_for_archetype(None), automation.INTERVIEW_RUBRICS["experienced"])
        self.assertEqual(automation.rubric_for_archetype("nonsense"), automation.INTERVIEW_RUBRICS["experienced"])


if __name__ == "__main__":
    unittest.main()
