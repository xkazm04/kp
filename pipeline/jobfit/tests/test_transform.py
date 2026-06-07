from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import match, score_job
from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.transferable import domain_distance
from pipeline.jobfit.transform import build_match_candidate, compute_potential


def _student() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="student",
        role_family="software_engineering",
        education_level="bachelor",
        education_detail="Computer Science, ČVUT FEL",
        languages=["Czech", "English"],
        aspirations=["Junior frontend developer"],
        skill_claims=[
            SkillClaim(skill="React", provenance="self_declared"),
            SkillClaim(skill="Git", provenance="coursework"),
        ],
        evidence=[
            Evidence(kind="thesis", title="Recommender web app", skills=["React", "TypeScript"], link="http://gh/x"),
            Evidence(kind="internship", title="Summer internship"),
        ],
    )


class PotentialTest(unittest.TestCase):
    def test_potential_positive_with_signals(self) -> None:
        score, signals = compute_potential(_student())
        self.assertGreater(score, 0.4)
        self.assertTrue(any("link" in s for s in signals))
        self.assertTrue(any("degree relevant" in s for s in signals))
        self.assertTrue(any("internship" in s for s in signals))

    def test_thin_profile_low_potential(self) -> None:
        thin = CandidateProfileV2(archetype="student", education_level="unknown")
        score, _ = compute_potential(thin)
        self.assertLess(score, 0.3)


class BuildCandidateTest(unittest.TestCase):
    def test_skills_unioned_and_best_provenance(self) -> None:
        c = build_match_candidate(_student())
        names = {s.casefold() for s in c.skills}
        # claims + evidence union; the internship also earns the generic
        # professional meta-skill baseline (transferable decoupling — the credit
        # follows the scoring model, not the career_switcher id).
        self.assertTrue({"react", "git", "typescript"} <= names)
        self.assertTrue({"teamwork", "communication"} <= names)
        # React appears in a self_declared claim AND a thesis evidence -> strongest (thesis) wins.
        react_key = next(s for s in c.skills if s.casefold() == "react")
        self.assertEqual(c.skill_provenance[react_key], "thesis")

    def test_early_career_defaults(self) -> None:
        c = build_match_candidate(_student())
        self.assertEqual(c.archetype, "student")
        self.assertEqual(c.seniority, "junior")
        self.assertEqual(c.provenance_default, "self_declared")
        self.assertIsNotNone(c.potential_score)
        self.assertTrue(c.learning_signals)


class EarlyCareerMatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.candidate = build_match_candidate(_student())
        self.entry_job = normalize_job(
            {
                "title": "Junior Frontend Developer",
                "seniority": "junior",
                "role_family": "software_engineering",
                "languages": ["English"],
                "description": "Graduates welcome; mentoring provided.",
                "requirements": [
                    {"skill": "React", "kind": "must_have", "hardness": "learnable"},
                    {"skill": "TypeScript", "kind": "must_have", "hardness": "learnable"},
                ],
            }
        )
        self.senior_job = normalize_job(
            {
                "title": "Senior Frontend Engineer",
                "seniority": "senior",
                "role_family": "software_engineering",
                "languages": ["English"],
                "description": "Own the platform; lead a squad.",
                "requirements": [{"skill": "React", "kind": "must_have", "hardness": "prerequisite"}],
            }
        )

    def test_non_entry_role_is_ko_filtered(self) -> None:
        resp = match(self.candidate, [self.entry_job, self.senior_job], limit=10)
        ids = [m.job_id for m in resp.matches]
        self.assertEqual(resp.meta["koFiltered"], 1)  # the senior, non-entry role
        self.assertIn(self.entry_job.id, ids)
        self.assertNotIn(self.senior_job.id, ids)

    def test_provenance_lets_thesis_skill_match(self) -> None:
        # React's strongest provenance is the thesis (0.75) -> exceeds the 0.5 match threshold.
        m = score_job(self.candidate, self.entry_job)
        self.assertIn("React", m.matched_skills)

    def test_career_slot_carries_potential(self) -> None:
        m = score_job(self.candidate, self.entry_job)
        self.assertAlmostEqual(m.career_score, self.candidate.potential_score or 0.0)


def _switcher(prior_title: str, role_family: str = "data_ai") -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="career_switcher",
        role_family=role_family,
        years_experience=6,
        skill_claims=[SkillClaim(skill="Python", provenance="coursework")],
        evidence=[Evidence(kind="job", title=prior_title, text="6 years")],
    )


class DomainDistanceTest(unittest.TestCase):
    def test_adjacent_prior_field(self) -> None:
        # finance analyst -> data work: the surface signals neighbour the family.
        distance, reason = domain_distance(_switcher("Finance analyst").evidence, "data_ai")
        self.assertEqual(distance, "adjacent")
        self.assertTrue(reason)

    def test_moderate_when_meta_skills_map_but_domain_does_not(self) -> None:
        # a nurse moving into data: real professional background, no adjacency.
        distance, _ = domain_distance(_switcher("Nurse, hospital ward").evidence, "data_ai")
        self.assertEqual(distance, "moderate")

    def test_far_without_any_prior_role(self) -> None:
        distance, reason = domain_distance([], "data_ai")
        self.assertEqual(distance, "far")
        self.assertIn("no prior", reason)

    def test_distance_threads_onto_the_match_candidate(self) -> None:
        c = build_match_candidate(_switcher("Finance analyst"))
        self.assertEqual(c.domain_distance, "adjacent")
        # …and lifts foundation, so the adjacent switcher's potential beats the far one's.
        far = build_match_candidate(_switcher("Professional violinist"))
        self.assertEqual(far.domain_distance, "far")
        self.assertGreater(c.potential_score or 0, far.potential_score or 0)

    def test_non_switchers_carry_no_distance(self) -> None:
        self.assertIsNone(build_match_candidate(_student()).domain_distance)


class TransferableDecouplingTest(unittest.TestCase):
    def test_student_with_out_of_field_job_earns_meta_skills(self) -> None:
        # The credit is gated on the SCORING MODEL, not the career_switcher id: a
        # student whose brigáda was in another field still earned real professional
        # meta-skills (the assignment's "brigády často mimo obor" case).
        student = _student()
        student.evidence.append(Evidence(kind="job", title="Sales assistant (part-time)", text="weekend shifts"))
        c = build_match_candidate(student)
        self.assertIn("communication", [s.casefold() for s in c.transferable_skills])
        comm_key = next(s for s in c.skills if s.casefold() == "communication")
        self.assertEqual(c.skill_provenance[comm_key], "professional")

    def test_student_without_prior_role_earns_nothing(self) -> None:
        c = build_match_candidate(_student())  # internship present, but no signals map; generic baseline applies
        # the internship IS a prior professional track — the generic baseline applies;
        # a profile with no job/internship at all must stay empty.
        bare = _student()
        bare.evidence = [e for e in bare.evidence if e.kind not in ("job", "internship")]
        self.assertEqual(build_match_candidate(bare).transferable_skills, [])
        self.assertTrue(c.transferable_skills)  # the internship earned the baseline

    def test_bau_stays_out(self) -> None:
        bau = CandidateProfileV2(
            archetype="bau",
            role_family="software_engineering",
            years_experience=8,
            evidence=[Evidence(kind="job", title="Engineering manager", skills=["Python"])],
        )
        self.assertEqual(build_match_candidate(bau).transferable_skills, [])


if __name__ == "__main__":
    unittest.main()
