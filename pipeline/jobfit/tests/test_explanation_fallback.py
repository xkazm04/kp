"""The template explanation is marked where it is made (reasons guarantee, key goal 4).

When the model returns no explanation the pipeline substitutes `_explanation_fallback`.
That text is not a reasons block, so it carries a coded `explanation_fallback`
trust finding that the write path and the reasons meter key on. Same mocked-Gemini
harness as test_pipeline.py.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.tests.test_pipeline import _payload, _run

_CV = "Jane Doe. Senior backend engineer, 8 years Python and Go at a fintech. Led payments."


def _codes(result) -> list[str]:
    return [f.code for f in result.trust_findings or []]


class ExplanationFallbackTest(unittest.TestCase):
    def test_missing_explanation_gives_fallback_and_coded_finding(self) -> None:
        payload = _payload(total=83, skills=25)
        payload["explanation"] = "   "
        result = _run(_CV, payload)
        self.assertIn("was assessed as", result.explanation)
        self.assertIn("explanation_fallback", _codes(result))
        finding = next(f for f in result.trust_findings if f.code == "explanation_fallback")
        self.assertEqual((finding.scope, finding.severity), ("insight", "warn"))
        # one-to-one and in order with sanity_checks
        self.assertEqual([f.text for f in result.trust_findings], list(result.sanity_checks))

    def test_model_explanation_gives_no_such_finding(self) -> None:
        result = _run(_CV, _payload(total=83, skills=25))
        self.assertEqual(result.explanation, "Solid candidate.")
        self.assertNotIn("explanation_fallback", _codes(result))

    def test_uncomputed_score_fallback_quotes_no_number(self) -> None:
        payload = _payload(total=83, skills=25)
        del payload["score"]
        payload["explanation"] = ""
        result = _run(_CV, payload)
        codes = _codes(result)
        self.assertIn("score_section_missing", codes)
        self.assertIn("explanation_fallback", codes)
        self.assertIn("Score not computed", result.explanation)
        self.assertNotIn("/100", result.explanation)


if __name__ == "__main__":
    unittest.main()
