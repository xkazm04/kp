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


class ExtractPrePassDegradeTest(unittest.TestCase):
    """An encrypted/corrupt CV makes the local pypdf pre-pass throw — but Gemini
    reads the raw bytes itself, so a parse failure must degrade the cheap pre-pass
    (empty evidence + a flag), not abort an analysis the LLM could still finish."""

    def _run_with_extract(self, extract):
        with mock.patch.object(P, "extract_text", extract), mock.patch.object(
            P, "analyze_profile_with_gemini", lambda *a, **k: (_PAYLOAD, [], {})
        ):
            return P.analyze_cv(Path("locked.pdf"))

    def test_extraction_failure_does_not_abort_analysis(self) -> None:
        from pypdf.errors import PdfReadError

        def _locked(_p):
            raise PdfReadError("File has not been decrypted")

        result = self._run_with_extract(_locked)
        # The Gemini-driven core analysis is preserved end to end.
        self.assertEqual(result.score.total, 83)
        self.assertEqual(result.salary.minimum, 90000)
        self.assertEqual(result.candidate.name, "Jane Doe")
        # The pre-pass degraded to empty deterministic evidence.
        evidence = result.metadata.deterministic_evidence
        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.detected_skills, [])
        self.assertEqual(evidence.detected_signals, [])
        self.assertIsNone(evidence.detected_seniority)
        # ...and the failure is flagged for a human, naming the parse error.
        self.assertTrue(
            any("Local text extraction failed" in c for c in result.sanity_checks)
        )
        self.assertTrue(any("PdfReadError" in c for c in result.sanity_checks))
        # The pypdf-vs-Gemini comparison still renders with empty local text.
        self.assertEqual(result.extraction_comparison.pypdf_text, "")
        self.assertEqual(result.extraction_quality.pypdf_text_length, 0)

    def test_pre_pass_build_failure_keeps_text_but_empties_evidence(self) -> None:
        # Extraction succeeds; only the in-memory rule pass blows up. The extracted
        # text is retained (it feeds the extractor comparison) while evidence empties.
        with mock.patch.object(P, "_build_deterministic_evidence", _boom):
            result = self._run_with_extract(lambda _p: _RAW_TEXT)
        self.assertEqual(result.score.total, 83)
        evidence = result.metadata.deterministic_evidence
        self.assertEqual(evidence.detected_skills, [])
        self.assertTrue(
            any("Deterministic pre-pass failed" in c for c in result.sanity_checks)
        )
        # The successfully extracted text survived for the comparison view.
        self.assertGreater(result.extraction_quality.pypdf_text_length, 0)

    def test_clean_extraction_records_no_skip_flag(self) -> None:
        result = self._run_with_extract(lambda _p: _RAW_TEXT)
        self.assertFalse(
            any("extraction failed" in c.lower() for c in result.sanity_checks)
        )
        self.assertFalse(
            any("pre-pass failed" in c.lower() for c in result.sanity_checks)
        )


if __name__ == "__main__":
    unittest.main()
