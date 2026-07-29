"""artifact_checks (LLM-era controls #3/#6) — the mechanical ground-truth checks.

Pins the two case-sim findings:
  * round 2: a canary whose file is ABSENT from a changed-files-only submission
    must read `propagated` (the flaw survived unexamined), never a free `addressed`.
  * round 2→3: baseline similarity is Jaccard over added lines vs the seed, so a
    clipped/differently-sized copy of the same file no longer collapses the signal.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.artifact_checks import baseline_similarity, canary_outcomes

SEED = {
    "files": [
        {"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\n"},
        {"path": "DECISIONS.md", "contents": "# D\n"},
    ],
    "canaries": [
        {
            "id": "c1",
            "kind": "wrong_constant",
            "path": "config.py",
            "flaw": "the constant 'RATE = 0.15' contradicts the docs",
            "groundTruth": "0.05",
            "reveals": "r",
        }
    ],
}


class CanaryOutcomes(unittest.TestCase):
    def test_addressed_when_fragment_removed(self):
        files = [{"path": "config.py", "contents": "RATE = 0.05\nX = 1\nY = 2\n"}]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "addressed")

    def test_propagated_when_untouched(self):
        files = [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\nZ = 3\n"}]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "propagated")

    def test_absent_file_is_propagated_not_addressed(self):
        # case-sim round 2: a changed-files-only submission that never touched the
        # canary's file used to score a free "addressed" (fragment "gone").
        files = [{"path": "other.py", "contents": "print('hi')\n"}]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "propagated")
        self.assertIn("not part of the submission", out["note"])

    def test_foreign_base_rewrite_is_unverifiable_not_addressed(self):
        # case-sim round 3: a same-path file rebuilt from a different base (or
        # invented from scratch) used to score a free "addressed" whose fake
        # verdict then poisoned the LLM judge as mechanical ground truth.
        files = [{"path": "config.py", "contents": "totally = 'different'\nfile = True\n"}]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "unverifiable")
        self.assertIn("does not descend", out["note"])

    def test_honest_edit_still_grades(self):
        # An edit that keeps most seed lines but fixes the flaw stays gradable.
        files = [{"path": "config.py", "contents": "RATE = 0.05\nX = 1\nY = 2\n"}]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "addressed")

    def test_flagged_when_voiced_in_decisions(self):
        files = [
            {"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\n"},
            {"path": "DECISIONS.md", "contents": "# D\nNoticed 'RATE = 0.15' looks wrong vs docs; left it, would ask the team.\n"},
        ]
        (out,) = canary_outcomes(SEED, files)
        self.assertEqual(out["status"], "flagged")


class BaselineSimilarity(unittest.TestCase):
    def _base(self, contents: str) -> dict:
        return {"solutions": [{"files": [{"path": "config.py", "contents": contents}], "note": "n"}]}

    def test_identical_added_lines_read_as_high_similarity(self):
        sub = [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\nNEW = 9\n"}]
        out = baseline_similarity(self._base("RATE = 0.15\nX = 1\nY = 2\nNEW = 9\n"), SEED, sub)
        self.assertTrue(out["available"])
        self.assertEqual(out["bestSimilarity"], 1.0)

    def test_divergent_contributions_read_low(self):
        sub = [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\nMINE = 'own work'\n"}]
        out = baseline_similarity(self._base("RATE = 0.15\nX = 1\nY = 2\nTHEIRS = 'model line'\n"), SEED, sub)
        self.assertEqual(out["bestSimilarity"], 0.0)

    def test_clipped_baseline_copy_does_not_poison_the_signal(self):
        # round-2 failure shape: the baseline holds a truncated copy of the file, so
        # whole-content ratios collapsed. With added-lines Jaccard, the shared new
        # line still registers: sub adds {NEW}, clipped baseline adds {NEW} (its
        # truncation DROPS seed lines but drops no additions).
        clipped = "RATE = 0.15\nNEW = 9\n"  # lost X/Y in the clip, kept the addition
        sub = [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\nY = 2\nNEW = 9\n"}]
        out = baseline_similarity(self._base(clipped), SEED, sub)
        self.assertEqual(out["bestSimilarity"], 1.0)

    def test_unavailable_without_solutions_or_files(self):
        self.assertFalse(baseline_similarity({"solutions": []}, SEED, [{"path": "a", "contents": "x"}])["available"])
        self.assertFalse(baseline_similarity(self._base("x"), SEED, None)["available"])


if __name__ == "__main__":
    unittest.main()
