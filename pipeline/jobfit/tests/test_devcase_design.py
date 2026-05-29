"""Phase D3 — design_role + design_case (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.design import (
    CASE_DESIGN_PROMPT_VERSION,
    ROLE_DESIGN_PROMPT_VERSION,
    design_case,
    design_role,
)
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis


class TestDesign(unittest.TestCase):
    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="senior", responsibilities=["APIs"])
        self.analysis = NeedAnalysis(
            real_stack=["Go", "PostgreSQL"], core_responsibilities=["Own ingest"], true_complexity="high", risk_areas=["scaling"]
        )

    def test_role_prefers_real_stack(self):
        role, source = design_role(self.need, self.analysis, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(role["seniority"], "senior")
        self.assertEqual(role["mustHaves"], ["Go", "PostgreSQL"])  # grounded in the code, not the claim
        self.assertEqual(role["promptVersion"], ROLE_DESIGN_PROMPT_VERSION)

    def test_case_has_covert_probes_and_full_rubric(self):
        role, _ = design_role(self.need, self.analysis, provider=None)
        case, _ = design_case(self.need, self.analysis, role, provider=None)
        self.assertGreaterEqual(len(case["coverProbes"]), 2)
        for p in case["coverProbes"]:
            self.assertIn(p["kind"], ("ambiguity", "legacy_trap", "verification_trap", "underspecified"))
            self.assertTrue(p["reveals"])  # internal note on what it reveals
        names = {d["name"] for d in case["rubricDimensions"]}
        self.assertEqual(names, {"framing", "tooling", "judgment", "architecture", "transfer"})
        self.assertAlmostEqual(sum(d["weight"] for d in case["rubricDimensions"]), 1.0, places=2)
        self.assertEqual(case["promptVersion"], CASE_DESIGN_PROMPT_VERSION)
        self.assertGreater(case["timeboxHours"], 0)


if __name__ == "__main__":
    unittest.main()
