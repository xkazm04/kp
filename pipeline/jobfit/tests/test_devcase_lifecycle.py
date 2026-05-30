"""D3 hardening — the lifecycle scenario harness (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.lifecycle_eval import run, run_submission_eval, signals
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

    def test_deterministic_probe_coverage_baseline(self):
        # the fallback is templated (3 fixed probe kinds); the LLM path adds variety.
        self.assertGreaterEqual(self.sig["probe_kind_diversity"], 0.75)

    def test_evaluator_discriminates_submissions(self):
        # Part 2: the evaluator must rank a strong submission above weak ones,
        # and not be fooled by the productive-looking AI-over-reliant trace.
        res = run_submission_eval(24, provider=None, subset=4)
        self.assertEqual(res["reliability"], 1.0)
        self.assertEqual(res["strong_ranks_first_rate"], 1.0)
        self.assertEqual(res["ai_overreliant_below_strong_rate"], 1.0)
        self.assertGreater(res["mean_margin_strong_vs_weak"], 0)


if __name__ == "__main__":
    unittest.main()
