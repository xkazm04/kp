"""P0-1: the deterministic role-family classifier must route non-tech occupations
to their own family instead of collapsing every CV to a technology family.

Companion to the LLM path (gemini.py lists the family catalog); this pins the
deterministic pre-pass / fallback used by job ingestion and the profile builder,
which do not always call the model.
"""
import unittest

from pipeline.jobfit.taxonomy import (
    DEFAULT_FAMILY,
    ROLE_FAMILIES,
    classify_role_family,
)


class RoleFamilyRoutingTest(unittest.TestCase):
    def test_non_tech_roles_route_to_their_family(self) -> None:
        cases = [
            ("Registered nurse, 8 years in the ICU at a Level I trauma center; CCRN.", "healthcare_clinical"),
            ("Licensed electrician wiring commercial sites for a general contractor.", "skilled_trades"),
            ("Warehouse forklift operator and order picker at a distribution centre.", "operations_logistics"),
            ("Cashier and store associate at a busy retail shop for three years.", "frontline_service"),
            ("High-school teacher and university lecturer; faculty member since 2014.", "education_academic"),
            ("Senior accountant and auditor preparing month-end financial statements.", "finance_accounting"),
            ("Research scientist with a PhD running a wet lab; postdoctoral in biochemistry.", "life_sciences_research"),
            ("Account manager and sales representative exceeding B2B quota.", "sales_marketing"),
            ("Graphic designer and art director building brand campaigns.", "creative_design"),
            ("Customer support agent on the help desk resolving tickets.", "customer_support"),
            ("Corporate lawyer and legal counsel advising on commercial contracts.", "legal_compliance"),
            ("Talent acquisition partner and recruiter hiring across teams.", "hr_people"),
        ]
        for text, expected in cases:
            self.assertEqual(
                classify_role_family([], text), expected,
                f"{text!r} should route to {expected!r}",
            )

    def test_tech_still_routes_to_tech(self) -> None:
        self.assertEqual(
            classify_role_family(
                ["python", "react", "kubernetes"],
                "Senior software engineer building backend services in Python.",
            ),
            "software_engineering",
        )

    def test_signal_free_text_falls_back_to_neutral_default(self) -> None:
        self.assertEqual(DEFAULT_FAMILY, "general_professional")
        self.assertEqual(
            classify_role_family([], "Experienced professional seeking a new opportunity."),
            DEFAULT_FAMILY,
        )

    def test_expected_families_exist(self) -> None:
        for fam in (
            "healthcare_clinical", "life_sciences_research", "skilled_trades",
            "operations_logistics", "frontline_service", "sales_marketing",
            "finance_accounting", "legal_compliance", "hr_people",
            "education_academic", "creative_design", "customer_support",
            "general_professional",
        ):
            self.assertIn(fam, ROLE_FAMILIES, f"missing role family {fam!r}")


class AmbiguousRoutingTest(unittest.TestCase):
    """Every case above is an UNAMBIGUOUS one-family sentence. Real CVs are not:
    a hybrid CV votes near-equally for two families and something has to break the
    tie. Until now that behaviour was incidental (whatever ``ROLE_FAMILIES``
    iteration happened to do first). It is now documented on
    ``classify_role_family``: highest score wins, and an EXACT tie goes to the
    family declared FIRST in ``ROLE_FAMILIES`` (= ``salary_benchmarks.json::roles``
    order). These pin that rule so it cannot drift silently.
    """

    def _both_alone_route_as_expected(self, a: str, fam_a: str, b: str, fam_b: str) -> None:
        # Non-vacuity: each half really does own its family on its own, so the
        # combined sentence is a genuine tie and not one signal drowning the other.
        self.assertEqual(classify_role_family([], a), fam_a)
        self.assertEqual(classify_role_family([], b), fam_b)

    def test_exact_tie_goes_to_the_first_declared_family(self) -> None:
        # "recruiter" (hr_people) and "accountant" (finance_accounting) carry equal
        # vote weight, so the text scores IDENTICALLY for both families.
        self._both_alone_route_as_expected(
            "recruiter", "hr_people", "accountant", "finance_accounting"
        )
        self.assertLess(
            ROLE_FAMILIES.index("finance_accounting"), ROLE_FAMILIES.index("hr_people")
        )
        # Declaration order decides — and word order in the text does NOT.
        self.assertEqual(classify_role_family([], "recruiter and accountant"), "finance_accounting")
        self.assertEqual(classify_role_family([], "accountant and recruiter"), "finance_accounting")

    def test_exact_tie_is_stable_across_a_second_family_pair(self) -> None:
        # Same rule, different pair: healthcare_clinical is declared before skilled_trades.
        self._both_alone_route_as_expected(
            "Registered nurse in the ICU",
            "healthcare_clinical",
            "Licensed electrician wiring commercial sites",
            "skilled_trades",
        )
        self.assertLess(
            ROLE_FAMILIES.index("healthcare_clinical"), ROLE_FAMILIES.index("skilled_trades")
        )
        self.assertEqual(
            classify_role_family([], "Registered nurse and licensed electrician"),
            "healthcare_clinical",
        )

    def test_a_real_lead_beats_declaration_order(self) -> None:
        # The tie-break must only apply to TIES: software_engineering is declared
        # first, but the product signals genuinely outscore the one tech mention, so
        # the hybrid "PM with an engineering background" routes to product_project.
        self.assertLess(
            ROLE_FAMILIES.index("software_engineering"), ROLE_FAMILIES.index("product_project")
        )
        self.assertEqual(
            classify_role_family([], "Product manager with a software engineering background."),
            "product_project",
        )

    def test_routing_is_deterministic_across_repeated_calls(self) -> None:
        text = "recruiter and accountant"
        self.assertEqual({classify_role_family([], text) for _ in range(20)}, {"finance_accounting"})


if __name__ == "__main__":
    unittest.main()
