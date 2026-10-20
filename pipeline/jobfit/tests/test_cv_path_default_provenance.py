"""The CV path mints unevidenced claims at the same floor for every candidate.

UAT 2026-07-20 moved ``taxonomy.DEFAULT_PROVENANCE`` to ``self_declared`` and made
``transform.build_match_candidate`` pass it for every archetype, because the old
discount "applied only to early-career candidates, so the same unevidenced claim was
penalised for the person least able to evidence it and waived for everyone else"
(docs/features/matching/README.md). One minting site kept the segmented default:
``pipeline._v2_profile_from_payload`` stamped ``professional`` on every claim the
extraction left without a usable provenance - unless the CV read as early-career,
where it stamped ``self_declared``. The provenance is baked into the stored
``v2Profile``, so ``build_match_candidate``'s own default never saw it.

It fires wherever the extraction is thinnest: a claim with no provenance, a value
outside the vocabulary, and the fallback path with no ``skill_claims`` at all, where
every listed skill of an experienced candidate became joint-top-tier evidence.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import score_job
from pipeline.jobfit.models import CandidateProfile
from pipeline.jobfit.pipeline import _v2_profile_from_payload
from pipeline.jobfit.taxonomy import DEFAULT_PROVENANCE
from pipeline.jobfit.tests._helpers import mkjob
from pipeline.jobfit.transform import build_match_candidate

_SKILLS = ["Python", "Django"]


def _profile(years: float, seniority: str) -> CandidateProfile:
    return CandidateProfile(
        name="Test",
        raw_text="",
        years_experience=years,
        current_seniority=seniority,
        role_family="software_engineering",
        skills=list(_SKILLS),
        education_level="master",
        languages=["English"],
        traits=[],
    )


def _student(payload: dict) -> tuple[dict, CandidateProfile]:
    signals = {"is_enrolled": "true", "education_is_dominant": "true", "has_substantial_experience": "false"}
    return {**signals, **payload}, _profile(0, "junior")


def _experienced(payload: dict) -> tuple[dict, CandidateProfile]:
    signals = {"is_enrolled": "false", "education_is_dominant": "false", "has_substantial_experience": "true"}
    return {**signals, **payload}, _profile(8, "senior")


def _claim_provenance(payload: dict, profile: CandidateProfile) -> dict[str, str]:
    v2 = _v2_profile_from_payload(payload, profile)
    return {c.skill: c.provenance for c in v2.skill_claims}


class CvPathDefaultProvenanceTest(unittest.TestCase):
    def test_the_two_candidates_really_route_to_different_segments(self) -> None:
        """Positive control: without it the tests below could pass on two students."""
        student = _v2_profile_from_payload(*_student({}))
        experienced = _v2_profile_from_payload(*_experienced({}))
        self.assertNotEqual(student.archetype, experienced.archetype)

    def test_no_skill_claims_floors_every_segment(self) -> None:
        for build in (_student, _experienced):
            with self.subTest(segment=build.__name__):
                provs = _claim_provenance(*build({}))
                self.assertEqual(set(provs), set(_SKILLS))
                self.assertEqual(set(provs.values()), {DEFAULT_PROVENANCE})

    def test_missing_or_unrecognised_claim_provenance_floors_every_segment(self) -> None:
        claims = {"skill_claims": [{"skill": "Python"}, {"skill": "Django", "provenance": "work"}]}
        for build in (_student, _experienced):
            with self.subTest(segment=build.__name__):
                self.assertEqual(set(_claim_provenance(*build(claims)).values()), {DEFAULT_PROVENANCE})

    def test_a_stated_provenance_is_kept(self) -> None:
        claims = {"skill_claims": [{"skill": "Python", "provenance": "professional"}]}
        self.assertEqual(_claim_provenance(*_experienced(claims))["Python"], "professional")

    def test_identical_evidence_scores_the_same_across_segments(self) -> None:
        """The regression for the incident: a listed skill is unproven for everyone."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        for build in (_student, _experienced):
            with self.subTest(segment=build.__name__):
                result = score_job(build_match_candidate(_v2_profile_from_payload(*build({}))), job)
                self.assertNotIn("Python", result.matched_skills)
                self.assertIn("Python", result.unproven_skills)


if __name__ == "__main__":
    unittest.main()
