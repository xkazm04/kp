from __future__ import annotations

import unittest

from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.transferable import map_transferable
from pipeline.jobfit.transform import build_match_candidate, compute_potential


def _switcher() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="career_switcher",
        role_family="software_engineering",
        education_level="master",
        education_detail="Mathematics (prior); self-study in software",
        languages=["Czech", "English"],
        aspirations=["Junior backend developer"],
        years_experience=9,
        skill_claims=[SkillClaim(skill="Python", provenance="coursework")],
        evidence=[
            Evidence(kind="job", title="High school teacher", text="Taught mathematics for 9 years"),
            Evidence(kind="project", title="Django blog", skills=["Python", "Django"], link="http://gh/b"),
        ],
    )


class TransferableMapTest(unittest.TestCase):
    def test_teacher_maps_to_meta_skills(self) -> None:
        pairs = dict(map_transferable(_switcher().evidence))
        self.assertIn("mentoring", pairs)
        self.assertIn("communication", pairs)
        # baseline professional meta-skills from any prior role
        self.assertIn("ownership", pairs)

    def test_only_reads_job_internship(self) -> None:
        ev = [Evidence(kind="project", title="teacher-themed app", text="teacher")]
        self.assertEqual(map_transferable(ev), [])


class SwitcherTransformTest(unittest.TestCase):
    def test_transferable_skills_credited_professional(self) -> None:
        c = build_match_candidate(_switcher())
        self.assertTrue(c.transferable_skills)
        self.assertIn("communication", [s.casefold() for s in c.skills])
        comm = next(s for s in c.skills if s.casefold() == "communication")
        self.assertEqual(c.skill_provenance[comm], "professional")

    def test_prior_delivery_boosts_potential(self) -> None:
        score, signals = compute_potential(_switcher())
        self.assertGreater(score, 0.5)
        self.assertTrue(any("prior professional role" in s for s in signals))
        self.assertTrue(any("track record" in s for s in signals))

    def test_target_skill_stays_foundation_provenance(self) -> None:
        # Python came from coursework — still a student-grade foundation, NOT professional.
        c = build_match_candidate(_switcher())
        py = next(s for s in c.skills if s.casefold() == "python")
        self.assertNotEqual(c.skill_provenance[py], "professional")


if __name__ == "__main__":
    unittest.main()
