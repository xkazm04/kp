"""Enforce the v2 matching metrics + fairness probes in CI.

Reuses the deterministic eval (eval/matching_eval.py) so the same thresholds and
probes that produce the report also gate the test suite. No API key required.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.matching_eval import THRESHOLDS, run


class MatchingEvalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.report = run()

    def test_metrics_meet_thresholds(self) -> None:
        agg = self.report.aggregate()
        for metric, threshold in THRESHOLDS.items():
            self.assertGreaterEqual(agg.get(metric, 0.0), threshold, f"{metric} below {threshold}")

    def test_archetypes_routed_correctly(self) -> None:
        for s in self.report.scenarios:
            self.assertTrue(s.archetype_ok, f"{s.name} routed to {s.detected_archetype}")

    def test_early_career_matches_all_entry_eligible(self) -> None:
        for s in self.report.scenarios:
            if s.entry_precision is not None:
                self.assertEqual(s.entry_precision, 1.0, f"{s.name} returned a non-entry role")

    def test_fairness_probes_pass(self) -> None:
        for p in self.report.probes:
            self.assertTrue(p.passed, f"fairness probe failed: {p.name} — {p.detail}")

    def test_overall_passes(self) -> None:
        self.assertTrue(self.report.passes())


if __name__ == "__main__":
    unittest.main()
