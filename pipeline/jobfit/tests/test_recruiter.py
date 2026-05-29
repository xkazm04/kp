from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.recruiter import rank_candidates_for_job

EXPERIENCED = MatchCandidate(
    skills=["Python", "Django"],
    seniority="senior",
    role_family="software_engineering",
    languages=["English"],
    archetype="bau",
    label="Senior Dev",
)
STUDENT = MatchCandidate(
    skills=["Python"],
    skill_provenance={"Python": "thesis"},
    seniority="junior",
    role_family="software_engineering",
    languages=["English"],
    archetype="student",
    potential_score=0.6,
    label="Student A",
)

ENTRY_JOB = normalize_job(
    {
        "title": "Junior Python Developer",
        "seniority": "junior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "Graduates welcome; mentoring provided.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
    }
)
SENIOR_JOB = normalize_job(
    {
        "title": "Senior Python Engineer",
        "seniority": "senior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "Own the platform.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
)


class RecruiterTest(unittest.TestCase):
    def test_entry_job_both_eligible(self) -> None:
        rows = rank_candidates_for_job([("e1", EXPERIENCED), ("s1", STUDENT)], ENTRY_JOB)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["koPassed"] for r in rows))
        self.assertEqual({r["candidateId"] for r in rows}, {"e1", "s1"})

    def test_senior_job_filters_student(self) -> None:
        rows = rank_candidates_for_job([("e1", EXPERIENCED), ("s1", STUDENT)], SENIOR_JOB)
        by_label = {r["label"]: r for r in rows}
        self.assertTrue(by_label["Senior Dev"]["koPassed"])
        self.assertFalse(by_label["Student A"]["koPassed"])
        self.assertTrue(any("early-career" in r for r in by_label["Student A"]["koReasons"]))

    def test_rows_carry_archetype_assumptions_provenance(self) -> None:
        rows = rank_candidates_for_job([("s1", STUDENT)], ENTRY_JOB)
        row = rows[0]
        self.assertEqual(row["candidateId"], "s1")
        self.assertEqual(row["archetype"], "student")
        self.assertTrue(row["assumptions"])  # early-career note at least
        self.assertEqual(row["result"]["matchedSkillProvenance"].get("Python"), "thesis")


if __name__ == "__main__":
    unittest.main()
