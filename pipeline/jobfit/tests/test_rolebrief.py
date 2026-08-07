"""RoleBrief (role-intake Phase 0) — the canonical structured hiring need.

Pins the three contracts the schema module makes:

* ``coerce_role_brief`` is a floor for untrusted payloads: off-vocabulary enums
  fall to defaults, floats clamp to 0..1, entries without a skill/value drop,
  and camelCase (wire) keys read as well as snake_case. Never raises.
* ``role_brief_from_spec`` lifts a legacy flat RoleSpec into graded
  requirements with the documented default grading and the caller's provenance.
* The requirement vocabulary is PINNED to jobs.JobRequirement so a brief always
  projects losslessly onto the matching engine.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import JobRequirement
from pipeline.jobfit.rolebrief import (
    BRIEF_PROVENANCE,
    BriefFacet,
    BriefRequirement,
    RoleBrief,
    brief_job_requirements,
    coerce_role_brief,
    role_brief_from_spec,
)


class CoerceRoleBriefTest(unittest.TestCase):
    def test_untrusted_payload_clamps_and_drops(self) -> None:
        brief = coerce_role_brief(
            {
                "title": "  Platform Engineer  ",
                "seniority": "Principal",  # off-vocabulary → default
                "requirements": [
                    {"skill": "Kubernetes", "kind": "MUST-HAVE", "weight": 7, "confidence": -1},
                    {"skill": "", "kind": "must_have"},  # no skill → dropped
                    "not-a-dict",  # → dropped
                ],
                "facets": [
                    {"key": "urgency", "value": "backfill, empty seat costs a sprint", "importance": "critical"},
                    {"key": "team_context", "value": ""},  # no value → dropped
                ],
            }
        )
        self.assertEqual(brief.title, "Platform Engineer")
        self.assertEqual(brief.seniority, "medior")
        self.assertEqual(len(brief.requirements), 1)
        req = brief.requirements[0]
        self.assertEqual(req.kind, "must_have")  # "MUST-HAVE" normalized
        self.assertEqual(req.weight, 1.0)  # 7 clamps
        self.assertEqual(req.confidence, 0.0)  # -1 clamps
        self.assertEqual(len(brief.facets), 1)
        self.assertEqual(brief.facets[0].importance, "valuable")  # "critical" off-vocab

    def test_requirement_source_turn_coerces(self) -> None:
        # LLM ints pass (camelCase or snake), garbage/bools drop to None.
        brief = coerce_role_brief(
            {
                "requirements": [
                    {"skill": "SQL", "sourceTurn": 3},
                    {"skill": "dbt", "source_turn": 5},
                    {"skill": "Python", "sourceTurn": True},
                    {"skill": "Go", "sourceTurn": "seven"},
                ]
            }
        )
        by_skill = {r.skill: r.source_turn for r in brief.requirements}
        self.assertEqual(by_skill, {"SQL": 3, "dbt": 5, "Python": None, "Go": None})

    def test_camelcase_wire_keys_read(self) -> None:
        brief = coerce_role_brief(
            {
                "roleFamily": "marketing_communications",
                "successCriteria": ["Owns the channel mix by day 90"],
                "facets": [{"key": "why_now", "value": "team lead left", "sourceTurn": 4}],
            }
        )
        self.assertEqual(brief.role_family, "marketing_communications")
        self.assertEqual(brief.success_criteria, ["Owns the channel mix by day 90"])
        self.assertEqual(brief.facets[0].source_turn, 4)

    def test_garbage_never_raises(self) -> None:
        for payload in (None, "text", 42, [], {"requirements": "nope", "facets": 3}):
            brief = coerce_role_brief(payload)
            self.assertIsInstance(brief, RoleBrief)
            self.assertEqual(brief.requirements, [])

    def test_wire_dump_is_camelcase(self) -> None:
        brief = RoleBrief(
            success_criteria=["x"],
            facets=[BriefFacet(key="urgency", value="now", source_turn=2)],
        )
        dumped = brief.model_dump(by_alias=True)
        self.assertIn("successCriteria", dumped)
        self.assertIn("schemaVersion", dumped)
        self.assertEqual(dumped["facets"][0]["sourceTurn"], 2)


class RoleBriefFromSpecTest(unittest.TestCase):
    def test_lift_grades_musts_and_nices(self) -> None:
        brief = role_brief_from_spec(
            {
                "title": "Data Analyst",
                "seniority": "senior",
                "roleFamily": "data_analytics",
                "mustHaves": ["SQL", "Python"],
                "niceToHaves": ["dbt"],
                "responsibilities": ["Own reporting"],
            },
            provenance="stated",
            confidence=0.9,
        )
        self.assertEqual(brief.title, "Data Analyst")
        kinds = {r.skill: (r.kind, r.hardness, r.weight) for r in brief.requirements}
        self.assertEqual(kinds["SQL"], ("must_have", "prerequisite", 0.8))
        self.assertEqual(kinds["dbt"], ("nice_to_have", "learnable", 0.4))
        self.assertTrue(all(r.provenance == "stated" for r in brief.requirements))
        self.assertTrue(all(r.confidence == 0.9 for r in brief.requirements))

    def test_snake_case_spec_reads_too(self) -> None:
        brief = role_brief_from_spec({"must_haves": ["React"], "nice_to_haves": [], "role_family": "software_engineering"})
        self.assertEqual(brief.requirements[0].skill, "React")
        self.assertEqual(brief.requirements[0].provenance, "inferred")


class VocabularyPinTest(unittest.TestCase):
    def test_requirement_vocabulary_matches_job_requirement(self) -> None:
        # BriefRequirement.kind/hardness must stay the JobRequirement vocabulary —
        # the projection below is only lossless while the defaults agree.
        self.assertEqual(BriefRequirement().kind, JobRequirement(skill="x").kind)
        self.assertEqual(BriefRequirement().hardness, JobRequirement(skill="x").hardness)
        self.assertIn(BriefRequirement().provenance, BRIEF_PROVENANCE)

    def test_projection_onto_matching_engine(self) -> None:
        brief = RoleBrief(
            requirements=[
                BriefRequirement(skill="SQL", kind="must_have", hardness="prerequisite", weight=0.9),
                BriefRequirement(skill="dbt", kind="nice_to_have", hardness="learnable"),
                BriefRequirement(skill=""),  # never projects
            ]
        )
        projected = brief_job_requirements(brief)
        self.assertEqual([r.skill for r in projected], ["SQL", "dbt"])
        self.assertTrue(all(isinstance(r, JobRequirement) for r in projected))
        self.assertEqual(projected[1].kind, "nice_to_have")


if __name__ == "__main__":
    unittest.main()
