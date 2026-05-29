from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import (
    MatchCandidate,
    ko_filter,
    match,
    score_career,
    score_skills,
)


def mkjob(**over):
    base = {
        "title": "Role",
        "seniority": "senior",
        "role_family": "software_engineering",
        "description": "A team building things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return normalize_job(base)


SENIOR_PY = MatchCandidate(
    skills=["Python", "Django", "PostgreSQL", "AWS"],
    seniority="senior",
    role_family="software_engineering",
    education_level="master",
    languages=["Czech", "English"],
    years_experience=8,
)
JUNIOR = MatchCandidate(
    skills=["Python"],
    seniority="junior",
    role_family="software_engineering",
    education_level="bachelor",
    languages=["Czech", "English"],
)


class KoFilterTest(unittest.TestCase):
    def test_seniority_gap_blocks_junior_from_senior_only(self) -> None:
        job = mkjob(seniority="senior", description="Seasoned engineer to own the platform.")
        passed, reasons = ko_filter(JUNIOR, job)
        self.assertFalse(passed)
        self.assertTrue(any("seniority" in r for r in reasons))

    def test_entry_eligible_role_bypasses_seniority_gap(self) -> None:
        job = mkjob(seniority="senior", description="Graduates welcome; training and mentoring provided.")
        passed, _ = ko_filter(JUNIOR, job)
        self.assertTrue(passed)

    def test_medior_to_senior_allowed(self) -> None:
        cand = MatchCandidate(seniority="medior", languages=["English"])
        job = mkjob(seniority="senior", description="Owns a service.")
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)  # one-level stretch is allowed

    def test_education_floor(self) -> None:
        job = mkjob(min_education="master", languages=["English"])
        cand = MatchCandidate(seniority="senior", education_level="bachelor", languages=["English"])
        passed, reasons = ko_filter(cand, job)
        self.assertFalse(passed)
        self.assertTrue(any("education" in r for r in reasons))

    def test_unknown_education_not_blocked(self) -> None:
        job = mkjob(min_education="master", languages=["English"])
        cand = MatchCandidate(seniority="senior", education_level="unknown", languages=["English"])
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)

    def test_missing_language_blocks(self) -> None:
        job = mkjob(languages=["German"])
        passed, reasons = ko_filter(SENIOR_PY, job)
        self.assertFalse(passed)
        self.assertTrue(any("language" in r for r in reasons))

    def test_empty_candidate_languages_are_lenient(self) -> None:
        job = mkjob(languages=["German"])
        cand = MatchCandidate(skills=["Python"], seniority="senior", languages=[])
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)

    def test_work_mode_preference(self) -> None:
        job = mkjob(work_mode="onsite", languages=["English"])
        cand = MatchCandidate(seniority="senior", languages=["English"], preferred_work_modes=["remote", "hybrid"])
        passed, reasons = ko_filter(cand, job)
        self.assertFalse(passed)
        self.assertTrue(any("work mode" in r for r in reasons))


class ScoringTest(unittest.TestCase):
    def test_skills_score_and_matched(self) -> None:
        job = mkjob(
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Kubernetes", "kind": "nice_to_have", "hardness": "learnable"},
            ]
        )
        score, matched, missing = score_skills(SENIOR_PY, job)
        self.assertIn("Python", matched)
        self.assertIn("Django", matched)
        self.assertGreater(score, 0.6)
        # Kubernetes is only nice-to-have and unmatched, so it must NOT be a missing must-have.
        self.assertNotIn("Kubernetes", missing)

    def test_hierarchy_partial_match_counts(self) -> None:
        # Candidate knows Next.js; role wants React -> specialization implies it.
        cand = MatchCandidate(skills=["Next.js"], seniority="medior", languages=["English"])
        job = mkjob(requirements=[{"skill": "React", "kind": "must_have", "hardness": "prerequisite"}])
        score, matched, _ = score_skills(cand, job)
        self.assertIn("React", matched)
        self.assertGreater(score, 0.5)

    def test_missing_must_have_listed(self) -> None:
        cand = MatchCandidate(skills=["Python"], seniority="senior", languages=["English"])
        job = mkjob(requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}])
        _, _, missing = score_skills(cand, job)
        self.assertIn("Go", missing)

    def test_career_same_family_beats_different(self) -> None:
        same = score_career(SENIOR_PY, mkjob(role_family="software_engineering", seniority="senior"))
        diff = score_career(SENIOR_PY, mkjob(role_family="data_ai", seniority="senior"))
        self.assertGreater(same, diff)


class MatchTest(unittest.TestCase):
    def test_ranking_and_meta(self) -> None:
        good = mkjob(
            title="Senior Python Engineer",
            role_family="software_engineering",
            seniority="senior",
            languages=["English"],
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        weak = mkjob(
            title="Senior PM",
            role_family="product_project",
            seniority="senior",
            languages=["English"],
            requirements=[
                {"skill": "product management", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "stakeholder management", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        # SENIOR_PY (Czech/English) is KO'd from a German-only role.
        blocked = mkjob(title="German-only role", seniority="senior", languages=["German"])

        resp = match(SENIOR_PY, [good, weak, blocked], limit=10)
        ids = [m.job_id for m in resp.matches]
        self.assertEqual(resp.meta["koFiltered"], 1)  # the German-only role
        self.assertEqual(resp.matches[0].title, "Senior Python Engineer")
        self.assertEqual(len(ids), 2)
        self.assertGreater(resp.matches[0].total, resp.matches[1].total)

    def test_confidence_band_widens_for_thin_profile(self) -> None:
        thin = MatchCandidate(skills=["Python"], seniority="junior", education_level="unknown", languages=[])
        job = mkjob(seniority="junior", description="Graduates welcome.")
        resp = match(thin, [job], limit=1)
        m = resp.matches[0]
        self.assertGreater(m.confidence_high - m.confidence_low, 8)


if __name__ == "__main__":
    unittest.main()
