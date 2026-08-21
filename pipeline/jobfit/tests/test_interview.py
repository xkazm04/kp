"""The mock-interview kit's red-flag-defense bucket.

`recruiter_risk_flags` is a free-text LLM list with no "return [] when clean"
contract, so a clean CV routinely comes back as a SENTENCE saying there are no
risks. Fed forward verbatim that absence became an accusation — a question asking
the candidate to defend "no significant concerns" and a phantom evidence gap in
the kit summary. These pin the shared `is_no_risk_statement` guard from both
directions: a non-finding never becomes a question, and a real finding that merely
opens with "No" always does.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit.interview import build_interview_kit, is_no_risk_statement
from pipeline.jobfit.models import CandidateProfile, JobFitResult


def _candidate() -> CandidateProfile:
    return CandidateProfile(
        name="Jana Nováková",
        raw_text="Backend engineer.",
        years_experience=6.0,
        current_seniority="senior",
        role_family="software_engineering",
        skills=["Python", "SQL"],
        education_level="bachelor",
        languages=["Czech", "English"],
        traits=[],
    )


def _job_fit(flags: list[str]) -> JobFitResult:
    return JobFitResult(
        score=78,
        summary="",
        matching_skills=["Python"],
        missing_skills=[],
        seniority_alignment="",
        role_alignment="",
        salary_assessment="",
        recommendations=[],
        recruiter_risk_flags=flags,
    )


class NoRiskStatementTest(unittest.TestCase):
    def test_absence_of_a_risk_is_not_a_risk(self):
        for clean in (
            "No major red flags.",
            "No significant concerns identified.",
            "No obvious risks for this role.",
            "There are no concerns with this candidate.",
            "No notable weaknesses.",
            "Nothing concerning in the CV.",
            "None",
            "N/A",
            "",
        ):
            with self.subTest(clean=clean):
                self.assertTrue(is_no_risk_statement(clean))

    def test_a_real_finding_is_kept_even_when_it_starts_with_no(self):
        for real in (
            "No evidence of Kubernetes anywhere in the CV.",
            "No formal degree, while the JD requires a completed BSc.",
            "Candidate lists no certifications, which is a concern for the compliance requirement.",
            "Two-year employment gap is unexplained.",
            "Salary expectation is 40% above the band.",
        ):
            with self.subTest(real=real):
                self.assertFalse(is_no_risk_statement(real))


class RedFlagBucketTest(unittest.TestCase):
    def _red_flag_questions(self, flags: list[str]):
        kit = build_interview_kit(_candidate(), _job_fit(flags))
        self.assertIsNotNone(kit)
        return kit, [q for q in kit.questions if q.bucket == "red-flag-defense"]

    def test_clean_flag_falls_back_to_the_self_assessed_gap_question(self):
        kit, red = self._red_flag_questions(["No significant concerns identified."])
        self.assertEqual(len(red), 1)
        # The honest fallback for "no flags", not a question defending a non-finding.
        self.assertEqual(red[0].evidence_gap, "Self-assessed gap (no recruiter flag detected)")
        self.assertNotIn("no significant concerns", red[0].question.lower())
        # …and it is not counted as an evidence gap in the summary either.
        self.assertIn("0 evidence gap(s)", kit.summary)

    def test_a_real_flag_still_produces_its_defense_question(self):
        kit, red = self._red_flag_questions(["Two-year employment gap is unexplained."])
        self.assertEqual(len(red), 1)
        self.assertEqual(red[0].evidence_gap, "Recruiter risk: Two-year employment gap is unexplained.")
        self.assertIn("1 evidence gap(s)", kit.summary)


if __name__ == "__main__":
    unittest.main()
