"""D3 hardening — the lifecycle scenario harness (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.lifecycle_eval import run, signals
from pipeline.jobfit.devcase.scenarios import generate_scenarios


class TestLifecycleEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scn = generate_scenarios(60)
        cls.rows = run(cls.scn, provider=None)
        cls.sig = signals(cls.rows)

    def test_landscape_has_variety(self):
        self.assertEqual(len(self.scn), 60)
        self.assertTrue(any(s.planted["mismatch"] for s in self.scn))
        self.assertTrue(any(s.planted["sparse"] for s in self.scn))
        self.assertTrue(any(s.planted["ambiguous"] for s in self.scn))
        self.assertGreaterEqual(len({s.planted["family"] for s in self.scn}), 5)

    def test_deterministic_pipeline_is_reliable(self):
        failures = [(r.id, r.issues) for r in self.rows if not r.reliable]
        self.assertEqual(self.sig["reliability"], 1.0, failures)

    def test_deterministic_catches_planted_mismatches(self):
        # the fallback mechanically diffs stated vs snapshot stack
        self.assertEqual(self.sig["gap_caught_on_mismatch"], 1.0)
        # …and it does so BECAUSE of the plant, not for every need: the behaviour-matched
        # control (needs whose stated stack matches the snapshot) sits far below it.
        self.assertGreater(self.sig["gap_detection_lift"], 0.5)

    def test_planted_flag_signals_report_a_matched_control(self):
        """2026-08-22: a raw hit-rate over the planted-positive subset certifies nothing —
        clarify_probe_on_ambiguous read 1.0 on ambiguous AND non-ambiguous needs alike
        (the templates always plant an `underspecified` probe), so a signal that could
        never fail was reported as perfect detection. Both signals now carry their control
        and lift; this pins that the lift is COMPUTED and honest, not that it is high."""
        self.assertIsNotNone(self.sig["clarify_probe_on_non_ambiguous"])
        self.assertIsNotNone(self.sig["clarify_probe_lift"])
        self.assertEqual(self.sig["clarify_probe_on_ambiguous"], 1.0)
        # The deterministic designer emits the clarify probe unconditionally, so the honest
        # reading of that 1.0 is a lift of 0.0 — the number the report must now show.
        self.assertEqual(self.sig["clarify_probe_lift"], 0.0)

    def test_deterministic_probe_coverage_baseline(self):
        # the fallback is templated (3 fixed probe kinds); the LLM path adds variety.
        self.assertGreaterEqual(self.sig["probe_kind_diversity"], 0.75)


if __name__ == "__main__":
    unittest.main()
