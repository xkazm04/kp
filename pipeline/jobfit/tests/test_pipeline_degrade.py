from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.pipeline as P

# A complete, valid Gemini payload: a real profile + score + salary so the
# expensive core analysis succeeds. The tests then force a cheap post-Gemini
# insight helper to throw and assert the completed analysis is NOT voided.
_RAW_TEXT = (
    "Jane Doe is a senior backend engineer with 8 years building Python and Go "
    "services at a fintech. Led a team of four, owned the payments platform, "
    "mentored juniors and shipped the billing rewrite."
) * 2

_PAYLOAD = {
    "profile": {
        "raw_text": _RAW_TEXT,
        "name": "Jane Doe",
        "years_experience": 8,
        "current_seniority": "senior",
        "role_family": "backend",
        "education_level": "master",
        "skills": ["Python", "Go", "Postgres"],
    },
    "score": {
        "experience": 20,
        "skills": 25,
        "role_seniority": 20,
        "education": 10,
        "traits": 8,
        "total": 83,
    },
    "salary": {"minimum": 90000, "maximum": 130000, "currency": "CZK", "period": "month"},
    "strengths": ["Strong backend"],
    "gaps": [],
    "recommendations": [],
    "explanation": "Solid senior backend candidate.",
}


def _boom(*_args, **_kwargs):
    raise RuntimeError("simulated helper bug")


class PostGeminiInsightDegradeTest(unittest.TestCase):
    """A bug in a cheap deterministic insight must downgrade the result, not
    discard an analysis whose expensive Gemini call already succeeded."""

    def _run(self) -> object:
        with mock.patch.object(P, "extract_text", lambda _p: _RAW_TEXT), mock.patch.object(
            P, "analyze_profile_with_gemini", lambda *a, **k: (_PAYLOAD, [], {})
        ):
            return P.analyze_cv(Path("fake.pdf"))

    def test_baseline_produces_all_insights_without_skip_flags(self) -> None:
        result = self._run()
        self.assertEqual(result.score.total, 83)
        self.assertIsNotNone(result.evidence_trace)
        self.assertFalse(any("insight skipped" in c for c in result.sanity_checks))

    def test_evidence_trace_failure_degrades_and_flags(self) -> None:
        with mock.patch.object(P, "build_evidence_trace", _boom):
            result = self._run()
        # Core analysis preserved.
        self.assertEqual(result.score.total, 83)
        self.assertEqual(result.salary.minimum, 90000)
        # Add-on degraded + flagged, not raised.
        self.assertIsNone(result.evidence_trace)
        self.assertTrue(any("Evidence trace unavailable" in c for c in result.sanity_checks))

    def test_interview_kit_failure_degrades_and_flags(self) -> None:
        with mock.patch.object(P, "build_interview_kit", _boom):
            result = self._run()
        self.assertEqual(result.score.total, 83)
        self.assertIsNone(result.interview_kit)
        self.assertTrue(any("Interview kit unavailable" in c for c in result.sanity_checks))


if __name__ == "__main__":
    unittest.main()
