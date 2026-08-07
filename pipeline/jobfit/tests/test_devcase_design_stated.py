"""Role-intake grading reaches role design (UAT L1-EVA-3): the brief's graded
dealbreakers (DevNeed.stated_requirements) anchor mustHaves on the
deterministic path and ride the LLM prompt as need.statedRequirements."""

import unittest

from pipeline.jobfit.devcase.design import design_role
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis


def _need() -> DevNeed:
    return DevNeed(
        title="Analytics Engineer",
        stack=["SQL"],
        seniority_target="medior",
        stated_requirements=[
            {"skill": "dbt", "kind": "must_have", "hardness": "prerequisite", "weight": 0.9},
            {"skill": "SQL", "kind": "must_have", "hardness": "prerequisite", "weight": 0.7},
            {"skill": "Python", "kind": "nice_to_have", "hardness": "learnable", "weight": 0.4},
        ],
    )


class TestStatedRequirements(unittest.TestCase):
    def test_deterministic_musts_lead_with_stated_grading(self) -> None:
        role, source = design_role(_need(), NeedAnalysis(real_stack=["Snowflake"], core_responsibilities=["Own reporting"]), provider=None)
        self.assertEqual(source, "deterministic")
        # Stated musts weight-ordered first, real stack fills after, nices honored.
        self.assertEqual(role["mustHaves"][:2], ["dbt", "SQL"])
        self.assertIn("Snowflake", role["mustHaves"])
        self.assertEqual(role["niceToHaves"], ["Python"])

    def test_prompt_carries_the_grading(self) -> None:
        captured = {}

        class Capture:
            def complete_json(self, prompt, system=None):
                captured["prompt"] = prompt
                return {}

        design_role(_need(), NeedAnalysis(real_stack=["Snowflake"]), provider=Capture())
        self.assertIn("statedRequirements", captured["prompt"])
        self.assertIn("dbt", captured["prompt"])
        self.assertIn("nice_to_have", captured["prompt"])

    def test_pre_intake_needs_unchanged(self) -> None:
        need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="senior")
        role, _ = design_role(need, NeedAnalysis(real_stack=["Go"]), provider=None)
        self.assertEqual(role["mustHaves"], ["Go"])
        self.assertEqual(role["niceToHaves"], [])

    def test_round_trips_camel_case(self) -> None:
        dumped = _need().model_dump(by_alias=True)
        self.assertEqual(dumped["statedRequirements"][0]["skill"], "dbt")
        restored = DevNeed.model_validate(dumped)
        self.assertEqual(restored.stated_requirements[0].weight, 0.9)


if __name__ == "__main__":
    unittest.main()
