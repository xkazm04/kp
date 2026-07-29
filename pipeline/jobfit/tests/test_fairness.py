"""Enforce the v2 matching metrics + fairness probes in CI.

Reuses the deterministic eval (eval/matching_eval.py) so the same thresholds and
probes that produce the report also gate the test suite. No API key required.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.matching_eval import (
    SCENARIOS,
    THRESHOLDS,
    Report,
    ScenarioResult,
    run,
)


class GateHonestyTest(unittest.TestCase):
    """The gate must not pass vacuously on an UNMEASURED fairness axis (bug-ui-scan
    2026-06-20): entry_precision used to default to 1.0 when no early-career scenario
    measured it, turning a coverage gap into an accuracy PASS."""

    def _scenario(self, entry: float | None) -> ScenarioResult:
        return ScenarioResult(
            name="x", detected_archetype="bau", archetype_ok=True,
            entry_precision=entry, role_relevance_at5=1.0, top_total=5,
        )

    def test_unmeasured_entry_precision_is_omitted_not_1(self) -> None:
        # Only non-early-career scenarios → entry_precision was never measured.
        report = Report(scenarios=[self._scenario(None)], probes=[])
        self.assertNotIn("entry_precision", report.aggregate())  # never substitute 1.0

    def test_unmeasured_gated_metric_fails(self) -> None:
        # entry_precision is gated (THRESHOLDS) but unmeasured → must FAIL, not pass.
        report = Report(scenarios=[self._scenario(None)], probes=[])
        self.assertFalse(report.passes())

    def test_measured_entry_precision_is_reported(self) -> None:
        report = Report(scenarios=[self._scenario(1.0)], probes=[])
        self.assertEqual(report.aggregate().get("entry_precision"), 1.0)


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
            with self.subTest(scenario=s.name):
                self.assertTrue(s.archetype_ok, f"{s.name} routed to {s.detected_archetype}")

    def test_early_career_matches_all_entry_eligible(self) -> None:
        for s in self.report.scenarios:
            if s.entry_precision is not None:
                with self.subTest(scenario=s.name):
                    self.assertEqual(s.entry_precision, 1.0, f"{s.name} returned a non-entry role")

    def test_fairness_probes_pass(self) -> None:
        for p in self.report.probes:
            with self.subTest(probe=p.name):
                self.assertTrue(p.passed, f"fairness probe failed: {p.name} — {p.detail}")

    def test_overall_passes(self) -> None:
        self.assertTrue(self.report.passes())

    def test_scenarios_span_non_tech_families(self) -> None:
        # The eval used to fixture EXCLUSIVELY on software_engineering / data_ai, so
        # the archetype -> weights -> confidence -> fairness interplay was measured on
        # tech only and a non-tech regression would ship green. Pin the coverage so it
        # cannot be quietly deleted back to tech-only.
        families = {s.profile.role_family for s in SCENARIOS}
        self.assertTrue(
            {"finance_accounting", "customer_support", "sales_marketing"} <= families,
            f"non-tech eval coverage lost: {sorted(families)}",
        )
        # …and the non-tech scenarios must span archetypes, not all be one shape.
        non_tech = {
            s.expected_archetype
            for s in SCENARIOS
            if s.profile.role_family not in ("software_engineering", "data_ai", "product_project")
        }
        self.assertTrue({"bau", "career_switcher"} <= non_tech, non_tech)


if __name__ == "__main__":
    unittest.main()
