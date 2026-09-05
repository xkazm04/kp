"""Direction: analyze-emits-honesty-fields.

The Gemini analysis emits FLAT job_fit matching/missing lists that cannot express
what the matching engine proves — that a skill the model called "missing" may be an
ADJACENCY near-miss (the candidate holds a sibling) rather than a true gap. These
tests exercise the deterministic cross-check wired into ``analyze_cv``: after the v2
profile is built it re-scores the SAME candidate against the JD's detected-skill
universe (matching.score_job, NO extra LLM call) and folds the engine's unproven
bucket onto job_fit.

The Gemini call and text extractor are mocked (same harness as test_pipeline) so no
network / API key is needed.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.pipeline as P
from pipeline.jobfit.models import JobFitResult


def _payload(*, missing: list[str], skills: list[str]) -> dict:
    """A complete, valid Gemini payload whose job_fit names ``missing`` as gaps and
    whose profile carries ``skills`` (professional provenance via the CV fallback)."""
    return {
        "profile": {
            "raw_text": ("Senior marketing specialist. " * 5) + " ".join(skills),
            "name": "Jane Doe",
            "years_experience": 8,
            "current_seniority": "senior",
            "role_family": "marketing_communications",
            "education_level": "master",
            "skills": skills,
        },
        "score": {
            "experience": 25,
            "skills": 24,
            "role_seniority": 23,
            "education": 12,
            "traits": 10,
            "total": 94,
        },
        "salary": {"minimum": 90000, "maximum": 130000, "currency": "CZK", "period": "month"},
        "strengths": ["Strong campaign track record"],
        "gaps": [],
        "recommendations": [],
        "explanation": "Solid candidate.",
        "job_fit": {
            "score": 70,
            "summary": "Good fit.",
            "matching_skills": skills,
            "missing_skills": missing,
            "seniority_alignment": "aligned",
            "role_alignment": "aligned",
            "salary_assessment": "in band",
            "recommendations": [],
        },
    }


def _run(payload: dict, *, jd: str | None, job_json: str | None = None) -> object:
    with mock.patch.object(P, "extract_text", lambda _p: payload["profile"]["raw_text"]), mock.patch.object(
        P, "analyze_profile_with_gemini", lambda *a, **k: (payload, [], {})
    ):
        return P.analyze_cv(Path("cv.pdf"), job_description_text=jd, job_json=job_json)


class AnalyzeHonestyFieldsTest(unittest.TestCase):
    def test_llm_missing_skill_reclassifies_as_adjacency(self) -> None:
        # The candidate holds SEO; the JD requires PPC (a taxonomy sibling of SEO).
        # Gemini flatly calls PPC "missing"; the deterministic cross-check knows the
        # candidate has an adjacent skill and surfaces PPC in the unproven bucket
        # tagged "adjacency" — the honest near-miss the flat list could not express.
        payload = _payload(missing=["PPC"], skills=["SEO"])
        result = _run(payload, jd="We need a specialist in PPC campaigns and paid search.")
        job_fit = result.job_fit
        assert job_fit is not None
        self.assertIsNotNone(job_fit.unproven_skills)
        # PPC (the JD's detected surface) is now in the unproven bucket, tagged adjacency.
        self.assertTrue(any("ppc" in s.lower() for s in job_fit.unproven_skills))
        key = next(s for s in job_fit.unproven_skills if "ppc" in s.lower())
        self.assertEqual(job_fit.unproven_skill_reason[key], "adjacency")
        # It is NOT re-asserted as a hard match, and the strength is sub-threshold.
        self.assertNotIn(key, job_fit.matching_skills)
        self.assertLess(job_fit.unproven_skill_strength[key], 0.5)

    def test_structured_job_requirements_are_used_as_stated(self) -> None:
        # Role-intake Phase 0: when the structured Job backing the JD is passed,
        # its authored requirement grading is the cross-check universe — the
        # adjacency reclassification still fires, now against stated requirements
        # instead of a regex-derived all-must_have flattening.
        import json

        payload = _payload(missing=["PPC"], skills=["SEO"])
        job_json = json.dumps(
            {
                "id": "jd-test",
                "title": "PPC Specialist",
                "company": "Acme",
                "location": "Praha",
                "requirements": [{"skill": "PPC", "kind": "must_have", "hardness": "learnable"}],
            }
        )
        result = _run(payload, jd="We need a specialist in PPC campaigns and paid search.", job_json=job_json)
        job_fit = result.job_fit
        assert job_fit is not None
        self.assertIsNotNone(job_fit.unproven_skills)
        self.assertTrue(any("ppc" in s.lower() for s in job_fit.unproven_skills))
        # A valid structured job leaves no degradation note behind.
        self.assertFalse(any("Structured job context" in c for c in result.sanity_checks))

    def test_malformed_job_json_degrades_with_note(self) -> None:
        # A malformed structured-job payload must not sink the (paid) analysis:
        # it degrades to the prose-only path and says so in the trust ledger.
        payload = _payload(missing=["PPC"], skills=["SEO"])
        result = _run(payload, jd="We need a specialist in PPC campaigns.", job_json="{not json")
        self.assertIsNotNone(result.job_fit)
        self.assertTrue(any("Structured job context" in c for c in result.sanity_checks))

    def test_gap_the_cv_contradicts_is_dropped_and_noted(self) -> None:
        # M4 — the symmetric trust gate. The CV plainly writes SEO, yet the model
        # also lists SEO as a gap: that gap would have become a stated rejection
        # reason and an interview-kit / keyword-panel input. It is dropped, the
        # genuine gap survives, and the drop is recorded in the trust ledger with
        # its count rather than happening silently.
        payload = _payload(missing=["SEO", "PPC"], skills=["SEO"])
        result = _run(payload, jd="We need a specialist in PPC campaigns and paid search.")
        job_fit = result.job_fit
        assert job_fit is not None
        self.assertNotIn("SEO", job_fit.missing_skills)
        self.assertIn("PPC", job_fit.missing_skills)
        note = next(c for c in result.sanity_checks if "AI-suggested gap" in c)
        self.assertIn("Dropped 1", note)
        self.assertIn("SEO", note)
        # The positive path is untouched: SEO is evidenced, so it stays a match.
        self.assertIn("SEO", job_fit.matching_skills)

    def test_gap_the_cv_does_not_evidence_is_left_alone(self) -> None:
        # No contradiction → no drop and no note; the ledger stays quiet.
        payload = _payload(missing=["PPC"], skills=["SEO"])
        result = _run(payload, jd="We need a specialist in PPC campaigns.")
        assert result.job_fit is not None
        self.assertEqual(result.job_fit.missing_skills, ["PPC"])
        self.assertFalse(any("AI-suggested gap" in c for c in result.sanity_checks))

    def test_jd_less_analysis_has_no_unproven_bucket(self) -> None:
        # No JD → no job_fit at all → the fields never populate (stay None).
        payload = _payload(missing=[], skills=["SEO"])
        result = _run(payload, jd=None)
        self.assertIsNone(result.job_fit)

    def test_fields_are_nullable_for_backcompat(self) -> None:
        # An old cached JobFitResult that predates these fields validates with the
        # keys ABSENT (nullable → None), never a required-field error.
        jf = JobFitResult(
            score=70,
            summary="",
            matching_skills=[],
            missing_skills=[],
            seniority_alignment="",
            role_alignment="",
            salary_assessment="",
            recommendations=[],
        )
        self.assertIsNone(jf.unproven_skills)
        self.assertIsNone(jf.unproven_skill_strength)
        self.assertIsNone(jf.unproven_skill_reason)
        # And the camelCase wire aliases exist once populated.
        jf.unproven_skills = ["ppc"]
        jf.unproven_skill_reason = {"ppc": "adjacency"}
        jf.unproven_skill_strength = {"ppc": 0.4}
        dumped = jf.model_dump(by_alias=True)
        self.assertEqual(dumped["unprovenSkills"], ["ppc"])
        self.assertEqual(dumped["unprovenSkillReason"], {"ppc": "adjacency"})


if __name__ == "__main__":
    unittest.main()
