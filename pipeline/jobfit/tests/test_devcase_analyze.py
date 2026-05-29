"""Phase D2 — analyze_need reality reflection (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.analyze import ANALYZE_NEED_PROMPT_VERSION, analyze_need
from pipeline.jobfit.devcase.models import DevNeed, RepoSnapshot


class TestAnalyzeNeed(unittest.TestCase):
    def test_grounded_detects_stated_vs_real_gaps(self):
        need = DevNeed(title="Backend", stack=["Python", "Django"], responsibilities=["APIs"], seniority_target="senior")
        snap = RepoSnapshot(ref="x/y", inferred_stack=["Go", "PostgreSQL"], top_dirs=["cmd", "internal"], loc=60_000)
        result, source = analyze_need(need, snap, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(result["realStack"], ["Go", "PostgreSQL"])  # grounded in the code, not the claim
        self.assertEqual(result["trueComplexity"], "high")  # 60k LOC
        joined = " ".join(result["statedVsRealGaps"]).lower()
        self.assertIn("python", joined)  # stated stack not evident in the code
        self.assertIn("go", joined)  # code uses tech absent from the stated stack
        self.assertEqual(result["promptVersion"], ANALYZE_NEED_PROMPT_VERSION)

    def test_ungrounded_without_snapshot(self):
        need = DevNeed(title="Backend", stack=["Python"], seniority_target="medior")
        result, _ = analyze_need(need, None, provider=None)
        self.assertEqual(result["realStack"], ["Python"])
        self.assertEqual(result["statedVsRealGaps"], [])
        self.assertLess(result["confidence"], 0.5)
        self.assertIn("ungrounded", result["reflection"].lower())


if __name__ == "__main__":
    unittest.main()
