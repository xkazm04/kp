"""Strengths and the explanation are checked against the CV (council value-1, key goal 4).

A strengths line naming a skill the CV never evidences is withheld with a coded
`strengths_withheld` finding. The explanation keeps the model's text but carries
`explanation_unverified_skill`, which the reasons meter counts as a named miss.
The two codes (and `explanation_fallback`) are pinned against the TS constants.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit import pipeline as P
from pipeline.jobfit.tests.test_pipeline import _payload, _run

REPO_ROOT = Path(__file__).resolve().parents[3]
REASONS_TS = REPO_ROOT / "app" / "_lib" / "reasons-coverage.ts"
_CV = "Jane Doe. Senior backend engineer, 8 years Python and Go at a fintech. Led payments."


def _codes(result) -> list[str]:
    return [f.code for f in result.trust_findings or []]


class UnverifiedSkillProseTest(unittest.TestCase):
    def test_untraceable_strength_is_withheld_and_explanation_is_flagged(self) -> None:
        payload = _payload(total=83, skills=25)
        payload["strengths"] = ["Strong Python delivery", "Deep Kubernetes operations"]
        payload["explanation"] = "Solid engineer with Terraform depth."
        result = _run(_CV, payload)
        self.assertEqual(result.strengths, ["Strong Python delivery"])
        self.assertEqual(result.explanation, "Solid engineer with Terraform depth.")
        codes = _codes(result)
        self.assertIn("strengths_withheld", codes)
        self.assertIn("explanation_unverified_skill", codes)
        finding = next(f for f in result.trust_findings if f.code == "explanation_unverified_skill")
        self.assertIn("terraform", finding.value.lower())
        self.assertNotIn("python", finding.value.lower())

    def test_traceable_prose_gets_no_finding(self) -> None:
        payload = _payload(total=83, skills=25)
        payload["strengths"] = ["Strong Python and Go delivery"]
        payload["explanation"] = "Python and Go evidence throughout."
        result = _run(_CV, payload)
        self.assertEqual(result.strengths, ["Strong Python and Go delivery"])
        self.assertNotIn("strengths_withheld", _codes(result))
        self.assertNotIn("explanation_unverified_skill", _codes(result))

    def test_a_skill_the_model_lists_as_a_gap_is_not_a_fabrication(self) -> None:
        payload = _payload(total=83, skills=25)
        payload["gaps"] = ["No Kubernetes experience"]
        payload["explanation"] = "Strong Python, but lacks Kubernetes."
        result = _run(_CV, payload)
        self.assertNotIn("explanation_unverified_skill", _codes(result))


class CodePairPinTest(unittest.TestCase):
    """The Python literal and the TS constant are one word, spelled twice."""

    def test_codes_match_reasons_coverage_ts(self) -> None:
        ts = REASONS_TS.read_text(encoding="utf-8")
        pairs = {
            "EXPLANATION_FALLBACK_CODE": P.EXPLANATION_FALLBACK_CODE,
            "EXPLANATION_UNVERIFIED_SKILL_CODE": P.EXPLANATION_UNVERIFIED_SKILL_CODE,
        }
        for name, py_value in pairs.items():
            m = re.search(r'export const ' + name + r'\s*=\s*"([^"]+)"', ts)
            self.assertIsNotNone(m, f"{name} missing from reasons-coverage.ts")
            self.assertEqual(m.group(1), py_value)


if __name__ == "__main__":
    unittest.main()
