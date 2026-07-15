from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax


class SurfaceResolutionTest(unittest.TestCase):
    def test_alias_still_resolves(self) -> None:
        # k8s -> Kubernetes: the v2 aliasing the brief calls out must keep working.
        self.assertEqual(tax.resolve_term("k8s"), "kubernetes")
        self.assertEqual(tax.resolve_term("Kubernetes"), "kubernetes")
        self.assertEqual(tax.resolve_term("k8s"), tax.resolve_term("Kubernetes"))

    def test_reactjs_compact_and_case_insensitive(self) -> None:
        self.assertEqual(tax.resolve_term("ReactJS"), "react")
        self.assertEqual(tax.resolve_term("Next.js"), "next_js")
        self.assertEqual(tax.resolve_term("nextjs"), "next_js")

    def test_unknown_surface_returns_none(self) -> None:
        # A surface the taxonomy genuinely does not model (Figma is now modelled).
        self.assertIsNone(tax.resolve_term("Blorptech9000"))
        self.assertIsNone(tax.resolve_term(""))

    def test_detected_skills_regression(self) -> None:
        # The flat-scan path the rest of the pipeline relies on is unaffected.
        found = tax.detected_skills("Built services with Kubernetes and Python")
        self.assertIn("kubernetes", [tax.resolve_term(s) for s in found])


class HierarchyTest(unittest.TestCase):
    def test_swiftui_is_subset_of_swift(self) -> None:
        # The brief's example: "SwiftUI je podmnožinou Swift".
        self.assertTrue(tax.is_subset_of("swiftui", "swift"))
        self.assertFalse(tax.is_subset_of("swift", "swiftui"))

    def test_transitive_ancestors(self) -> None:
        # selenium -> test_automation -> qa (two levels up).
        self.assertIn("test_automation", tax.ancestors("selenium"))
        self.assertIn("qa", tax.ancestors("selenium"))

    def test_all_parents_resolve_to_known_terms(self) -> None:
        ids = {term["id"] for term in tax._TERMS}
        for term in tax._TERMS:
            for parent in term.get("parents", []):
                self.assertIn(parent, ids, f"{term['id']} has dangling parent {parent}")

    def test_no_self_or_cycle_in_ancestors(self) -> None:
        for tid in {term["id"] for term in tax._TERMS}:
            self.assertNotIn(tid, tax.ancestors(tid), f"{tid} is its own ancestor (cycle)")


class MatchScoreTest(unittest.TestCase):
    def test_exact_match(self) -> None:
        self.assertEqual(tax.term_match_score("react", "react"), 1.0)

    def test_specialization_counts_high(self) -> None:
        # Candidate knows SwiftUI; role wants Swift -> they can clearly do Swift.
        self.assertAlmostEqual(tax.term_match_score("swiftui", "swift"), 0.9)

    def test_generalization_counts_partial(self) -> None:
        # Candidate knows only Swift; role wants SwiftUI -> foundation, not the framework.
        self.assertAlmostEqual(tax.term_match_score("swift", "swiftui"), 0.55)

    def test_unrelated_is_zero(self) -> None:
        self.assertEqual(tax.term_match_score("react", "python"), 0.0)

    def test_surface_level_partial_match(self) -> None:
        # Next.js (a React specialization) should partially satisfy a "React" requirement.
        score = tax.skill_match_score("Next.js", "React")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)

    def test_unknown_skill_matches_itself_by_string(self) -> None:
        # Not in the taxonomy, but identical strings should still match.
        self.assertEqual(tax.skill_match_score("Figma", "figma"), 1.0)
        self.assertEqual(tax.skill_match_score("Figma", "Sketch"), 0.0)

    def test_provenance_discounts_score(self) -> None:
        professional = tax.skill_match_score("React", "React", provenance="professional")
        academic = tax.skill_match_score("React", "React", provenance="academic_project")
        self_declared = tax.skill_match_score("React", "React", provenance="self_declared")
        self.assertEqual(professional, 1.0)
        self.assertLess(academic, professional)
        self.assertLess(self_declared, academic)

    def test_provenance_unknown_falls_back(self) -> None:
        self.assertEqual(
            tax.skill_match_score("React", "React", provenance="made_up"),
            tax.skill_match_score("React", "React", provenance=None),
        )


if __name__ == "__main__":
    unittest.main()
