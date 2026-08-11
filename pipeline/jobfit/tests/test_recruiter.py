from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.recruiter import (
    fairness_check,
    fairness_track,
    rank_candidates_by_track,
    rank_candidates_for_job,
)

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

    def test_rows_carry_a_fairness_track_and_group_splits_archetypes(self) -> None:
        # The fairness contract is now structural: every row carries a track, and the
        # grouped form never mixes a student with a senior on one incomparable total.
        self.assertEqual(fairness_track("bau"), "experienced")
        self.assertEqual(fairness_track("student"), "early_career")
        self.assertEqual(fairness_track("career_switcher"), "early_career")
        rows = rank_candidates_for_job([("e1", EXPERIENCED), ("s1", STUDENT)], ENTRY_JOB)
        self.assertTrue(all("track" in r for r in rows))
        grouped = rank_candidates_by_track([("e1", EXPERIENCED), ("s1", STUDENT)], ENTRY_JOB)
        self.assertEqual(set(grouped), {"experienced", "early_career"})
        self.assertEqual([r["candidateId"] for r in grouped["experienced"]], ["e1"])
        self.assertEqual([r["candidateId"] for r in grouped["early_career"]], ["s1"])

    def test_rows_carry_archetype_assumptions_provenance(self) -> None:
        rows = rank_candidates_for_job([("s1", STUDENT)], ENTRY_JOB)
        row = rows[0]
        self.assertEqual(row["candidateId"], "s1")
        self.assertEqual(row["archetype"], "student")
        self.assertTrue(row["assumptions"])  # early-career note at least
        self.assertEqual(row["result"]["matchedSkillProvenance"].get("Python"), "thesis")


class FairnessCheckTest(unittest.TestCase):
    def test_matrix_is_aligned_ranked_and_audited(self) -> None:
        ada = MatchCandidate(
            skills=["Python"], skill_provenance={"Python": "observed"}, seniority="junior",
            role_family="software_engineering", languages=["English"], archetype="student",
            potential_score=0.9, label="Ada",
        )
        bo = MatchCandidate(
            skills=["HTML"], seniority="junior", role_family="software_engineering",
            languages=["English"], archetype="student", potential_score=0.3, label="Bo",
        )
        fm = fairness_check([("a", ada), ("b", bo)], ENTRY_JOB)
        # labels / candidateIds align by index; matrix is square; own = the diagonal.
        self.assertEqual(fm["labels"], ["Ada", "Bo"])
        self.assertEqual(fm["candidateIds"], ["a", "b"])
        self.assertEqual(len(fm["matrix"]), 2)
        self.assertEqual(len(fm["matrix"][0]), 2)
        self.assertEqual(fm["own"], [fm["matrix"][0][0], fm["matrix"][1][1]])
        # Ada's observed, role-relevant must-have earns a weight adjustment (audited);
        # Bo (no relevant high-trust evidence) keeps the baseline.
        self.assertTrue(fm["weightNotes"]["a"])
        # Baseline weights carry their own note now — audited, never silent.
        self.assertIn("Baseline", fm["weightNotes"]["b"][0])
        # The stronger, observed-skill candidate is robustly first across schemes.
        self.assertEqual(fm["ranking"][0], "Ada")


if __name__ == "__main__":
    unittest.main()
