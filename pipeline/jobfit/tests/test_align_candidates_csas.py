"""align_candidates_csas must only re-skin the three tech families, and leave
non-tech candidates untouched (evaluation-fairness-seed-data #1). The old fallback
coerced a non-tech family onto software_engineering, overwriting its skill stack /
aspirations / targetRole with a Java stack while leaving roleFamily unchanged —
minting internally-inconsistent records that the non-tech jobs had no coherent
candidates to match."""

from __future__ import annotations

import unittest

from pipeline.jobfit.align_candidates_csas import align_record, TRACKS


class AlignCandidatesTest(unittest.TestCase):
    def test_non_tech_family_is_left_untouched(self) -> None:
        rec = {
            "roleFamily": "finance_accounting",
            "archetype": "bau",
            "skillClaims": [{"skill": "IFRS reporting"}],
            "targetRole": "Financial Analyst",
            "aspirations": ["Lead the reporting team"],
            "evidence": [{"skills": ["Excel", "SAP"]}],
        }
        out = align_record({**rec, "evidence": [{"skills": ["Excel", "SAP"]}]}, 3)
        # roleFamily, skills, aspirations, targetRole all preserved — NOT re-skinned to Java.
        self.assertEqual(out["roleFamily"], "finance_accounting")
        self.assertEqual(out["skillClaims"], [{"skill": "IFRS reporting"}])
        self.assertEqual(out["targetRole"], "Financial Analyst")
        self.assertEqual(out["aspirations"], ["Lead the reporting team"])
        self.assertEqual(out["evidence"], [{"skills": ["Excel", "SAP"]}])

    def test_a_tech_family_is_actually_aligned(self) -> None:
        # A software_engineering candidate keeps its family but gets a ČS track stack.
        self.assertIn("software_engineering", TRACKS)
        rec = {
            "id": "cand-001",
            "name": "Test Dev",
            "roleFamily": "software_engineering",
            "archetype": "bau",
            "seniority": "mid",
            "educationLevel": "bachelor",
            "skillClaims": [{"skill": "Go"}],
            "evidence": [{"title": "Built a service", "skills": ["Go"]}],
        }
        out = align_record(dict(rec), 0)
        self.assertEqual(out["roleFamily"], "software_engineering")
        # The generic "Go" claim was re-skinned onto the ČS stack.
        self.assertNotEqual(out.get("skillClaims"), [{"skill": "Go"}])


if __name__ == "__main__":
    unittest.main()
