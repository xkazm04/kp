"""Role rubric derivation (ADR-0012 §2, rolerubric.py).

Pins what the derivation promises its two consumers — the role_rubrics store and
the TS mirror in app/_lib/role-rubric.ts:

* The shared fixture: every case derives EXACTLY its expected axes (weights
  compared exactly). app/_lib/role-rubric.test.ts reads the same file, so the two
  languages cannot drift without one of the suites turning red.
* Every derived rubric is one the store will accept: unique non-blank keys,
  weights in 0..1 summing to 1, and evidence sources taken from the ADR's table.
* Deterministic: the same brief derives the same list every time, whatever order
  its duplicate rows arrive in.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from pipeline.jobfit.rolebrief import BriefFacet, BriefRequirement, RoleBrief
from pipeline.jobfit.rolerubric import RUBRIC_EVIDENCE_SOURCES, derive_role_rubric

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "role_rubric_cases.json"


def _cases() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _dump(brief: RoleBrief) -> list[dict]:
    return [axis.model_dump(by_alias=True) for axis in derive_role_rubric(brief)]


class FixtureParityTest(unittest.TestCase):
    def test_fixture_has_the_cases_the_ts_mirror_is_pinned_to(self):
        self.assertGreaterEqual(len(_cases()), 5)

    def test_every_case_derives_exactly_its_expected_axes(self):
        for case in _cases():
            with self.subTest(case=case["name"]):
                self.assertEqual(_dump(RoleBrief.model_validate(case["brief"])), case["expected"])


class RubricInvariantsTest(unittest.TestCase):
    def test_every_non_empty_rubric_is_one_the_store_accepts(self):
        for case in _cases():
            axes = derive_role_rubric(RoleBrief.model_validate(case["brief"]))
            if not axes:
                continue
            with self.subTest(case=case["name"]):
                keys = [a.key for a in axes]
                self.assertEqual(len(keys), len(set(keys)))
                self.assertTrue(all(k.strip() for k in keys))
                self.assertTrue(all(0.0 <= a.weight <= 1.0 for a in axes))
                self.assertTrue(math.isclose(math.fsum(a.weight for a in axes), 1.0, abs_tol=1e-9))
                for a in axes:
                    self.assertEqual((a.human_evidence, a.agent_evidence), RUBRIC_EVIDENCE_SOURCES[a.evidence_class])

    def test_blocking_means_must_have_prerequisite_and_nothing_else(self):
        brief = RoleBrief(
            requirements=[
                BriefRequirement(skill=f"s-{kind}-{hardness}", kind=kind, hardness=hardness)
                for kind in ("must_have", "nice_to_have")
                for hardness in ("prerequisite", "learnable")
            ]
        )
        blocking = {a.key for a in derive_role_rubric(brief) if a.blocking}
        self.assertEqual(blocking, {"req:s-must_have-prerequisite"})

    def test_duplicate_rows_collapse_the_same_whatever_their_order(self):
        rows = [
            BriefRequirement(skill="Czech", kind="nice_to_have", hardness="prerequisite", weight=0.7),
            BriefRequirement(skill="czech", kind="must_have", hardness="learnable", weight=0.2),
        ]
        forward = derive_role_rubric(RoleBrief(requirements=rows))
        backward = derive_role_rubric(RoleBrief(requirements=list(reversed(rows))))
        def grading(axes):
            return [(a.key, a.kind, a.hardness, a.weight, a.blocking) for a in axes]

        self.assertEqual(grading(forward), grading(backward))
        self.assertEqual(grading(forward), [("req:czech", "must_have", "prerequisite", 1.0, True)])

    def test_only_core_facets_become_axes(self):
        brief = RoleBrief(
            facets=[
                BriefFacet(key="team_context", label="Team", value="Squad of four", importance=importance)
                for importance in ("valuable", "context")
            ]
        )
        self.assertEqual(derive_role_rubric(brief), [])

    def test_a_non_finite_weight_reads_as_the_schema_default(self):
        nan = derive_role_rubric(RoleBrief(requirements=[BriefRequirement(skill="Go", weight=float("nan")), BriefRequirement(skill="Rust", weight=0.5)]))
        self.assertEqual([a.weight for a in nan], [0.5, 0.5])


if __name__ == "__main__":
    unittest.main()
