"""Role-intake grading reaches role design (UAT L1-EVA-3): the brief's graded
dealbreakers (DevNeed.stated_requirements) anchor mustHaves on the
deterministic path and ride the LLM prompt as need.statedRequirements."""

import unittest

from pipeline.jobfit.devcase.design import design_role
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis
from pipeline.jobfit.tests.devcase_fakes import TextReply


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

    def test_stated_dealbreakers_past_the_cap_are_never_trimmed(self) -> None:
        names = ["dbt", "SQL", "Airflow", "Python", "Snowflake", "Looker", "Git", "Testing"]
        need = DevNeed(
            title="Analytics Engineer",
            stack=["SQL"],
            seniority_target="medior",
            stated_requirements=[
                {"skill": s, "kind": "must_have", "hardness": "prerequisite", "weight": round(0.95 - 0.05 * i, 2)}
                for i, s in enumerate(names)
            ],
        )
        role, _ = design_role(need, NeedAnalysis(real_stack=["Redshift", "Fivetran"]), provider=None)
        # All eight confirmed dealbreakers survive, weight-ordered; the real-stack fill is what is bounded.
        self.assertEqual(role["mustHaves"], names)

    def test_prompt_carries_the_grading(self) -> None:
        capture = TextReply({})
        design_role(_need(), NeedAnalysis(real_stack=["Snowflake"]), provider=capture)
        self.assertIn("statedRequirements", capture.last_prompt)
        self.assertIn("dbt", capture.last_prompt)
        self.assertIn("nice_to_have", capture.last_prompt)

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


class TestLanguagesAreNeverInvented(unittest.TestCase):
    def test_keyless_need_without_a_language_returns_none(self) -> None:
        need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="senior")
        role, source = design_role(need, NeedAnalysis(real_stack=["Go"]), provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(role["languages"], [])

    def test_model_reply_without_languages_stays_empty(self) -> None:
        reply = TextReply({"title": "Backend Engineer", "mustHaves": ["Go"], "languages": []})
        role, _ = design_role(DevNeed(title="Backend Engineer", stack=["Go"]), NeedAnalysis(real_stack=["Go"]), provider=reply)
        self.assertEqual(role["languages"], [])

    def test_prompt_carries_the_extended_grounding_rule(self) -> None:
        capture = TextReply({})
        design_role(_need(), NeedAnalysis(real_stack=["Snowflake"]), provider=capture)
        self.assertIn("responsibilities restate or narrow", capture.last_prompt)
        self.assertIn("ONLY when the input names it", capture.last_prompt)

    def test_prompt_version_is_v5(self) -> None:
        role, _ = design_role(_need(), NeedAnalysis(), provider=None)
        self.assertEqual(role["promptVersion"], "role-design-v5")
