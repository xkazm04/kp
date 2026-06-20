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


if __name__ == "__main__":
    unittest.main()
