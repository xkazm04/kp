"""Guard: a seeded analysis is scored against the candidate's OWN role family.

The bank's non-tech candidate slice (seed_candidates.CSAS_NONTECH_ROLES —
accountants, personal bankers, contact-centre specialists) carries a
``targetRole`` that align_candidates_csas.TRACKS does not cover, and their
families are not in ``JD_DRAFTS``. That combination used to fall through to
``_DEFAULT_FAMILY``: every one of them was analyzed against the generic
*Software Engineer* JD — missing skills TypeScript/JavaScript/React/Node.js and
a salary anchored to the software_engineering band (a ČS accountant quoted
120–180k CZK/month). Deterministic, no LLM, no DB.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.seed_analyses import build_analysis
from pipeline.jobfit.seed_candidates import CSAS_NONTECH_ROLES
from pipeline.jobfit.taxonomy import role_band

_TECH_ONLY_SKILLS = {"typescript", "javascript", "react", "node.js"}


def _record(role: dict, *, ident: str = "cand-test") -> dict:
    """A minimal seeded candidate for one CSAS_NONTECH_ROLES entry."""
    return {
        "id": ident,
        "displayName": "Jana Nováková",
        "roleFamily": role["family"],
        "archetype": "bau",
        "seniority": "medior",
        "yearsExperience": 6,
        "educationLevel": "bachelor",
        "educationDetail": "VŠE Praha 2018",
        "languages": ["Czech", "English"],
        "aspirations": [role["target"]],
        "targetRole": role["target"],
        "skillClaims": [
            {"skill": s, "level": "strong", "provenance": "professional"} for s in role["skills"]
        ],
        "evidence": [
            {
                "kind": "job",
                "title": "Specialista",
                "text": "Denní agenda v bance.",
                "skills": role["skills"][:2],
                "link": None,
            }
        ],
    }


class NonTechAnalysisFamilyTest(unittest.TestCase):
    def test_every_nontech_role_is_analyzed_in_its_own_family(self) -> None:
        for role in CSAS_NONTECH_ROLES:
            with self.subTest(target=role["target"]):
                analysis = build_analysis(_record(role))
                self.assertEqual(analysis["role_family"], role["family"])
                # The JD they were scored against is their target role, not "Software Engineer".
                self.assertIn(role["target"], analysis["payload"]["jobFit"]["summary"])

    def test_nontech_gaps_are_not_the_frontend_stack(self) -> None:
        for role in CSAS_NONTECH_ROLES:
            with self.subTest(target=role["target"]):
                job_fit = build_analysis(_record(role))["payload"]["jobFit"]
                missing = {s.casefold() for s in job_fit["missingSkills"]}
                self.assertEqual(
                    missing & _TECH_ONLY_SKILLS,
                    set(),
                    f"{role['target']} was scored against a software-engineering JD: {sorted(missing)}",
                )

    def test_salary_is_anchored_to_the_candidates_own_family_band(self) -> None:
        """The seeded band tracks the candidate's family, not software_engineering.

        Every non-tech family the taxonomy prices sits BELOW the engineering band at
        the same level, so a bank back-office specialist seeded at or above the
        engineering ceiling means the wrong family anchored the salary.
        """
        se_max = role_band("software_engineering", "medior")[-1]
        for role in CSAS_NONTECH_ROLES:
            fam_band = role_band(role["family"], "medior")
            self.assertTrue(fam_band, f"taxonomy prices no band for {role['family']}")
            self.assertLess(fam_band[-1], se_max)  # the premise this test rests on
            with self.subTest(target=role["target"]):
                salary = build_analysis(_record(role))["payload"]["salary"]
                self.assertLess(
                    salary["maximum"],
                    se_max,
                    f"{role['target']} seeded on the software_engineering band ({salary})",
                )


if __name__ == "__main__":
    unittest.main()
