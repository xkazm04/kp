from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.match_reasoning import _system_for, deterministic_reasoning, generate, reasoning_context
from pipeline.jobfit.matching import MatchCandidate, score_job

CAND = MatchCandidate(
    skills=["Python", "Django", "PostgreSQL"],
    seniority="senior",
    role_family="software_engineering",
    education_level="master",
    languages=["English"],
    years_experience=8,
)
JOB = normalize_job(
    {
        "title": "Senior Backend Engineer",
        "seniority": "senior",
        "role_family": "software_engineering",
        "description": "Backend team.",
        "requirements": [
            {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "Go", "kind": "must_have", "hardness": "prerequisite"},
        ],
    }
)


class DeterministicTest(unittest.TestCase):
    def test_shape(self) -> None:
        ctx = reasoning_context(CAND, JOB, score_job(CAND, JOB))
        r = deterministic_reasoning(ctx)
        self.assertTrue(r["verdict"])
        self.assertTrue(r["strengths"])
        self.assertTrue(r["interviewProbes"])
        # Go is an unmet must-have -> should surface as a gap.
        self.assertTrue(any("Go" in g for g in r["gaps"]))

    def test_generate_without_provider_is_deterministic(self) -> None:
        _r, source = generate(CAND, JOB, score_job(CAND, JOB), provider=None)
        self.assertEqual(source, "deterministic")


class FakeProvider:
    def __init__(self, payload):
        self.payload = payload

    def complete_json(self, prompt, *, system=None):
        return self.payload


class LlmPathTest(unittest.TestCase):
    def test_generate_with_provider(self) -> None:
        payload = {
            "verdict": "Good fit.",
            "strengths": ["Knows Python"],
            "gaps": ["No Go"],
            "interviewProbes": ["Ask about Go."],
        }
        r, source = generate(CAND, JOB, score_job(CAND, JOB), provider=FakeProvider(payload))
        self.assertEqual(source, "llm")
        self.assertEqual(r["verdict"], "Good fit.")

    def test_partial_llm_payload_backfilled(self) -> None:
        # Missing verdict + strengths -> backfilled from the deterministic template.
        r, source = generate(CAND, JOB, score_job(CAND, JOB), provider=FakeProvider({"gaps": ["x"]}))
        self.assertEqual(source, "llm")
        self.assertTrue(r["verdict"])
        self.assertTrue(r["strengths"])

    def test_provider_exception_falls_back(self) -> None:
        class Boom:
            def complete_json(self, prompt, *, system=None):
                raise RuntimeError("cli down")

        _r, source = generate(CAND, JOB, score_job(CAND, JOB), provider=Boom())
        self.assertEqual(source, "deterministic")


class PersonaTest(unittest.TestCase):
    def test_persona_is_industry_and_market_aware_not_czech_tech(self) -> None:
        # The software job (no location -> default Praha) must not carry the old
        # hardcoded "Czech tech market" tech-recruiter persona, and should name the
        # role family + market it was given.
        sw = _system_for(JOB)
        self.assertNotIn("Czech tech market", sw)
        self.assertNotIn("technical recruiter", sw.lower())
        self.assertIn("Software", sw)
        self.assertIn("Praha", sw)  # market from job.location default

        # A non-tech role gets a non-tech lens + its own market.
        hjob = normalize_job(
            {
                "title": "ICU Nurse",
                "seniority": "senior",
                "role_family": "healthcare_clinical",
                "location": "Boston",
                "description": "ICU",
                "requirements": [{"skill": "ICU", "kind": "must_have"}],
            }
        )
        hs = _system_for(hjob)
        self.assertIn("Healthcare", hs)
        self.assertIn("Boston", hs)

    def test_reasoning_context_carries_real_cv_highlights(self) -> None:
        cand = MatchCandidate(
            skills=["ICU"],
            seniority="senior",
            role_family="healthcare_clinical",
            summary="8 years as an ICU nurse",
            experience_highlights=["Staff Nurse III — ventilator & CRRT care"],
            work_links=["https://example.org/portfolio"],
        )
        ctx = reasoning_context(cand, JOB, score_job(cand, JOB))
        self.assertEqual(ctx["candidate"]["summary"], "8 years as an ICU nurse")
        self.assertIn("Staff Nurse III — ventilator & CRRT care", ctx["candidate"]["experienceHighlights"])
        self.assertIn("https://example.org/portfolio", ctx["candidate"]["workLinks"])


if __name__ == "__main__":
    unittest.main()
