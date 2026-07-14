"""Direction 2: the partial-match machinery is alive OUTSIDE tech.

Before this, all 129 skill-category terms voted into the three tech families, so
``score_skills`` fell back to raw string equality (0.0 or 1.0) for every non-tech
role. These tests prove a bank/compliance JD+CV pair now earns GRADUATED skill
credit through the new taxonomy hierarchy — a related-but-not-identical skill
scores strictly between 0 and 1 via a ``parents`` edge.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax
from pipeline.jobfit.matching import MatchCandidate, score_skills
from pipeline.jobfit.tests._helpers import mkjob


class NonTechHierarchyTest(unittest.TestCase):
    def test_kyc_is_a_specialization_of_aml(self) -> None:
        # kyc -> aml edge authored in taxonomy.json.
        self.assertIn("aml", tax.ancestors("kyc"))
        self.assertTrue(tax.is_subset_of("kyc", "aml"))

    def test_specialization_scores_high_partial(self) -> None:
        # Candidate did KYC; role wants AML. KYC implies AML competence -> 0.9.
        score = tax.term_match_score("kyc", "aml")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertAlmostEqual(score, 0.9)

    def test_generalization_scores_low_partial(self) -> None:
        # Candidate did broad AML; role wants specifically KYC -> foundation only, 0.55.
        score = tax.term_match_score("aml", "kyc")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertAlmostEqual(score, 0.55)

    def test_surface_forms_resolve_bilingually(self) -> None:
        # Both an English and a Czech surface form reach the same term.
        self.assertEqual(tax.resolve_term("know your customer"), "kyc")
        self.assertEqual(tax.resolve_term("poznej svého klienta"), "kyc")
        self.assertEqual(tax.resolve_term("fakturace"), "invoicing")


class BankComplianceScoreSkillsTest(unittest.TestCase):
    """End-to-end score_skills on a synthetic bank compliance officer."""

    def _candidate(self, skills: list[str]) -> MatchCandidate:
        return MatchCandidate(
            skills=skills,
            seniority="senior",
            role_family="finance_accounting",
            languages=["Czech", "English"],
            years_experience=6,
        )

    def test_related_skill_earns_graduated_credit(self) -> None:
        # CV: officer who ran KYC and sanctions screening (Czech surface forms).
        cand = self._candidate(["poznej svého klienta", "sankční prověřování"])
        # JD: AML must-have (a broader requirement the CV specializes).
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "anti-money laundering", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength = score_skills(cand, job)
        # Graduated: strictly between a miss (0) and an exact match (1).
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("anti-money laundering", matched)
        self.assertNotIn("anti-money laundering", missing)
        self.assertLess(strength["anti-money laundering"], 1.0)

    def test_unrelated_nontech_skill_is_a_true_miss(self) -> None:
        # An officer with only invoicing experience makes NO claim to AML.
        cand = self._candidate(["fakturace"])
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "aml", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, _ = score_skills(cand, job)
        self.assertEqual(score, 0.0)
        self.assertIn("aml", missing)

    def test_exact_nontech_match_is_full_credit(self) -> None:
        cand = self._candidate(["kyc"])
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "kyc", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _, strength = score_skills(cand, job)
        self.assertAlmostEqual(score, 1.0)
        self.assertEqual(strength["kyc"], 1.0)


if __name__ == "__main__":
    unittest.main()
