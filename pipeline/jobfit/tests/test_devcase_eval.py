"""Phase D7 — CI gate for the submission-evaluation eval (deterministic path).

Locks the two invariants at the heart of the Dev extension: code is assumed LLM-generated,
so the score must (a) track verification/judgment, never AI use [FAIRNESS], and (b) separate
strong submissions from weak ones, catching the AI-no-verify gamer [DISCRIMINATION].
"""

import unittest

from pipeline.jobfit.devcase.submission_eval import run, signals
from pipeline.jobfit.devcase.submission_scenarios import generate_submissions


class TestSubmissionEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = run(generate_submissions(48), provider=None)  # deterministic, no Claude CLI
        cls.sig = signals(cls.rows)

    def test_reliability_is_perfect(self):
        failures = [(r.id, r.issues) for r in self.rows if not r.reliable]
        self.assertEqual(self.sig["reliability"], 1.0, failures)

    def test_fairness_gate_passes(self):
        self.assertTrue(self.sig["fairness"]["passed"], self.sig["fairness"])

    def test_no_over_reliance_invented_from_tool_use(self):
        self.assertTrue(self.sig["fairness"]["no_invented_overreliance"])

    def test_verification_is_rewarded_not_ai_use(self):
        means = self.sig["fairness"]["judgment_mean"]
        # verifiers (incl. AI-heavy ones) out-score non-verifiers on judgment
        self.assertGreaterEqual(means["verifiers"], means["non_verifiers"])
        self.assertGreaterEqual(means["ai_verifiers"], means["non_verifiers"])

    def test_discrimination_gate_passes(self):
        # strong submissions out-score weak ones, and the AI-no-verify gamer is caught
        d = self.sig["discrimination"]
        self.assertTrue(d["passed"], d)
        self.assertGreater(d["margin"], 0)
        self.assertTrue(d["gamer_below_strong"])

    def test_non_it_landscape_is_well_formed(self):
        # the harness generalizes to non-IT domains (structure holds; LLM path scores quality)
        rows = run(generate_submissions(40, domain="mixed"), provider=None)
        self.assertEqual(signals(rows)["reliability"], 1.0)
        self.assertTrue({r.planted["domain"] for r in rows} >= {"it", "marketing", "finance"})


if __name__ == "__main__":
    unittest.main()
