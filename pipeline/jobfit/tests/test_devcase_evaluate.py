"""Phase D6 — evaluate_submission + score_transfer (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.evaluate import (
    CASE_EVAL_PROMPT_VERSION,
    TRANSFER_PROMPT_VERSION,
    evaluate_submission,
    score_transfer,
)

_DIMS = {"framing", "tooling", "judgment", "architecture", "transfer"}


class TestEvaluate(unittest.TestCase):
    def setUp(self):
        self.reflection = {"readBeforeWrite": 0.7, "verificationHabits": ["adds tests", "iterates"], "narrative": "x"}
        self.tooling = {"fluency": 0.8, "probeOutcomes": [{"probeId": "p1", "handledWell": True}, {"probeId": "p2", "handledWell": False}]}
        self.case = {"rubricDimensions": [{"name": d, "weight": 0.2} for d in _DIMS]}
        self.role = {"title": "Backend", "seniority": "senior", "mustHaves": ["Go"], "responsibilities": ["APIs"]}

    def test_evaluation_has_all_five_dims_in_range(self):
        ev, source = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(set(ev["dimensionScores"].keys()), _DIMS)
        for v in ev["dimensionScores"].values():
            self.assertTrue(0 <= v <= 100)
        for k in ("structureScore", "judgmentScore", "architectureScore"):
            self.assertTrue(0 <= ev[k] <= 100)
        self.assertEqual(ev["promptVersion"], CASE_EVAL_PROMPT_VERSION)

    def test_transfer_is_avg_of_dims(self):
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        t, _ = score_transfer(ev, self.role, provider=None)
        avg = round(sum(ev["dimensionScores"].values()) / 5)
        self.assertEqual(t["transferScore"], avg)
        self.assertTrue(0 <= t["transferScore"] <= 100)
        self.assertEqual(t["promptVersion"], TRANSFER_PROMPT_VERSION)

    def test_strong_tooling_lifts_tooling_dim(self):
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertEqual(ev["dimensionScores"]["tooling"], 80)  # fluency 0.8 -> 80


if __name__ == "__main__":
    unittest.main()
