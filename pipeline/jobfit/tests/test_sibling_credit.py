"""Direction 2: shared-parent SIBLING credit — stop scoring cousins at zero.

``term_match_score`` used to graduate credit only along parent chains, so two
children of one parent (SEO vs PPC) scored 0.0 against each other. Siblings now
earn a documented value (0.4) that sits BELOW generalization (0.55) and — by
design — below the matcher's 0.5 partial-match threshold, so a bare sibling nudges
the skills sub-score as adjacent evidence without ever being reported as a
"matched" skill. Deeper cousins (shared grandparent only) stay 0.0.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax
from pipeline.jobfit.matching import _MATCH_THRESHOLD, MatchCandidate, score_skills
from pipeline.jobfit.tests._helpers import mkjob


class SiblingTermScoreTest(unittest.TestCase):
    def test_siblings_earn_the_documented_value(self) -> None:
        # SEO and PPC are both direct children of digital_marketing.
        self.assertEqual(tax._PARENTS["seo"], tax._PARENTS["ppc"])
        self.assertAlmostEqual(tax.term_match_score("seo", "ppc"), 0.4)
        self.assertAlmostEqual(tax.term_match_score("ppc", "seo"), 0.4)

    def test_sibling_value_is_below_generalization(self) -> None:
        self.assertLess(tax._SIBLING_MATCH, tax._GENERALIZATION_MATCH)

    def test_sibling_value_is_below_match_threshold_by_design(self) -> None:
        # The interplay the direction pins: a bare sibling must NOT clear the
        # matcher's partial-match threshold, so it can never masquerade as a match.
        self.assertLess(tax._SIBLING_MATCH, _MATCH_THRESHOLD)

    def test_specialization_and_generalization_unchanged(self) -> None:
        self.assertAlmostEqual(tax.term_match_score("swiftui", "swift"), 0.9)
        self.assertAlmostEqual(tax.term_match_score("swift", "swiftui"), 0.55)

    def test_deeper_cousins_stay_zero(self) -> None:
        # credit_scoring's parent is credit_analysis; mortgages' parent is
        # loan_origination. They share only the GRANDPARENT loan_origination — a
        # deeper cousin, not a direct sibling — so credit stays 0.0.
        self.assertNotEqual(tax._PARENTS["credit_scoring"], tax._PARENTS["mortgages"])
        self.assertIn("loan_origination", tax.ancestors("credit_scoring"))
        self.assertIn("loan_origination", tax.ancestors("mortgages"))
        self.assertEqual(tax.term_match_score("credit_scoring", "mortgages"), 0.0)

    def test_unrelated_terms_stay_zero(self) -> None:
        self.assertEqual(tax.term_match_score("react", "python"), 0.0)

    def test_top_level_terms_without_parents_are_not_siblings(self) -> None:
        # Two parentless roots must not be treated as siblings (empty parent sets).
        self.assertFalse(tax._PARENTS.get("aml"))
        self.assertFalse(tax._PARENTS.get("payments"))
        self.assertEqual(tax.term_match_score("aml", "payments"), 0.0)


class SiblingScoreSkillsBoundaryTest(unittest.TestCase):
    """Where a sibling hit lands in score_skills: partial-evidence, NOT matched,
    NOT missing — it nudges the sub-score but is never claimed as possession."""

    def _cand(self, skills: list[str]) -> MatchCandidate:
        # provenance_default is explicit: the shipped default is now `self_declared`,
        # which discounts every match. These tests are about where SIBLING credit
        # lands relative to the match threshold, not about the evidence discount,
        # so they pin the professional tier.
        return MatchCandidate(
            skills=skills, seniority="medior", role_family="sales_marketing",
            languages=["English"], years_experience=4,
            provenance_default="professional",
        )

    def test_sibling_only_is_neither_matched_nor_missing(self) -> None:
        # Candidate knows SEO; the role's sole must-have is PPC (its sibling).
        cand = self._cand(["seo"])
        job = mkjob(
            role_family="sales_marketing",
            requirements=[{"skill": "ppc", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        # The sibling nudges the skills sub-score (adjacent evidence)...
        self.assertGreater(score, 0.0)
        self.assertAlmostEqual(score, 0.4)
        # ...but it is NOT a proven match (below threshold)...
        self.assertNotIn("ppc", matched)
        self.assertNotIn("ppc", strength)
        # ...and NOT a true miss either: the candidate made a domain-adjacent claim,
        # so it must not inflate the "missing must-haves" count. It sits in the
        # claimed-but-unproven limbo (the honesty boundary Direction 3 surfaces).
        self.assertNotIn("ppc", missing)

    def test_exact_still_beats_a_sibling(self) -> None:
        cand = self._cand(["ppc"])
        job = mkjob(
            role_family="sales_marketing",
            requirements=[{"skill": "ppc", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _missing, strength, _unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 1.0)
        self.assertIn("ppc", matched)
        self.assertEqual(strength["ppc"], 1.0)


class TechHierarchyParityTest(unittest.TestCase):
    """tech-hierarchy-parity: the graded credit above must work for TECH too.

    Sibling/graded credit rides on parent links, and the three tech families used
    to carry them on 24% / 18% / 7% of their terms against 42-85% for every
    non-tech family. The payoff had inverted: a near-miss TECH specialist fell back
    to 0/1 string equality more often than an equivalent nurse or accountant. These
    mirror the non-tech assertions above on tech pairs — graduated credit, not 0/1.
    """

    def _graduated(self, a: str, b: str, expected: float) -> None:
        score = tax.term_match_score(a, b)
        self.assertGreater(score, 0.0, f"{a} vs {b} fell back to zero credit")
        self.assertLess(score, 1.0, f"{a} vs {b} was credited as an exact match")
        self.assertAlmostEqual(score, expected)

    def test_sibling_backend_frameworks(self) -> None:
        # The direction's headline case: two frameworks on the same runtime. (The
        # brief's Fastify is not modelled; Nest.js is its taxonomy equivalent — both
        # are Express-adjacent Node web frameworks under the node_js parent.)
        self.assertEqual(tax._PARENTS["express"], tax._PARENTS["nest_js"])
        self._graduated("express", "nest_js", tax._SIBLING_MATCH)
        self._graduated("nest_js", "express", tax._SIBLING_MATCH)

    def test_sibling_frontend_frameworks(self) -> None:
        # React vs Vue: both JavaScript frameworks. Pre-parity this was a flat 0.
        self._graduated("react", "vue", tax._SIBLING_MATCH)

    def test_sibling_relational_stores(self) -> None:
        self._graduated("postgresql", "mysql", tax._SIBLING_MATCH)

    def test_sibling_cloud_platforms(self) -> None:
        self._graduated("aws", "azure", tax._SIBLING_MATCH)

    def test_sibling_data_and_product_families(self) -> None:
        # data_ai and product_project were the two thinnest hierarchies (18% / 7%).
        self._graduated("llm", "nlp", tax._SIBLING_MATCH)
        self._graduated("snowflake", "bigquery", tax._SIBLING_MATCH)
        self._graduated("scrum", "kanban", tax._SIBLING_MATCH)
        self._graduated("product_owner", "product_manager", tax._SIBLING_MATCH)

    def test_specialization_and_generalization_are_directional(self) -> None:
        # Knowing the specialization implies the general skill (0.9); the reverse is
        # weaker (0.55) — the same asymmetry the non-tech kyc/aml pair proves.
        self._graduated("typescript", "javascript", 0.9)
        self._graduated("javascript", "typescript", tax._GENERALIZATION_MATCH)
        self._graduated("postgresql", "sql", 0.9)
        self._graduated("kubernetes", "docker", 0.9)

    def test_unrelated_tech_terms_still_score_zero(self) -> None:
        # Non-vacuity: the new links must not make everything tech-adjacent.
        self.assertEqual(tax.term_match_score("react", "python"), 0.0)
        self.assertEqual(tax.term_match_score("kubernetes", "scrum"), 0.0)

    def test_sibling_credit_lands_below_the_match_threshold_for_tech_too(self) -> None:
        # A sibling nudges the skills sub-score but is never REPORTED as possessed —
        # the same honesty boundary the sales_marketing fixture pins.
        cand = MatchCandidate(
            skills=["vue"], seniority="medior", role_family="software_engineering",
            languages=["English"], years_experience=4, provenance_default="professional",
        )
        job = mkjob(
            role_family="software_engineering",
            requirements=[{"skill": "react", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, tax._SIBLING_MATCH)
        self.assertLess(tax._SIBLING_MATCH, _MATCH_THRESHOLD)
        self.assertNotIn("react", matched)
        self.assertNotIn("react", strength)
        self.assertNotIn("react", missing)


if __name__ == "__main__":
    unittest.main()
