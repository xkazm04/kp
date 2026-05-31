"""The interview scorecard rubric lives authoritatively in automation.py and is
hand-mirrored in app/_lib/interview-rubric.ts (the recruiter-facing compare grid
reads the TS copy; the Python copy drives + validates LLM scoring). If the two
drift, a competency the model is scored on won't match the column the UI renders.
This test fails the moment they diverge so the mirror stays honest.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit import automation

_TS = Path(__file__).resolve().parents[3] / "app" / "_lib" / "interview-rubric.ts"


class TestRubricParity(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(_TS.exists(), f"TS rubric mirror not found at {_TS}")
        self.src = _TS.read_text(encoding="utf-8")

    def test_competencies_match(self) -> None:
        ts_pairs = re.findall(r'\{\s*competency:\s*"([^"]+)",\s*description:\s*"([^"]+)"\s*\}', self.src)
        ts_rubric = [{"competency": c, "description": d} for c, d in ts_pairs]
        self.assertEqual(ts_rubric, automation.INTERVIEW_RUBRIC, "interview-rubric.ts drifted from automation.INTERVIEW_RUBRIC")

    def test_anchors_match(self) -> None:
        ts_anchors = {int(k): v for k, v in re.findall(r'(\d+):\s*"([^"]+)"', self.src)}
        self.assertEqual(ts_anchors, automation.RATING_ANCHORS, "interview-rubric.ts anchors drifted from automation.RATING_ANCHORS")


if __name__ == "__main__":
    unittest.main()
