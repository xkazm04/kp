from __future__ import annotations

import unittest

from pipeline.jobfit.insights import apply_company_salary_context, build_company_context
from pipeline.jobfit.models import SalaryEstimate


class InsightRulesTest(unittest.TestCase):
    def test_enterprise_company_context_raises_salary_band(self) -> None:
        context = build_company_context("Large international corporate bank in Prague with strong benefits")
        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(context.company_type, "enterprise/corporate")
        self.assertGreater(context.adjustment_factor, 1.0)

        salary = SalaryEstimate(
            currency="CZK",
            period="month",
            minimum=100000,
            maximum=150000,
            midpoint=125000,
            confidence="medium",
            rationale=[],
        )
        apply_company_salary_context(salary, context)
        self.assertGreater(salary.minimum, 100000)
        self.assertTrue(any("company context" in item for item in salary.rationale))


if __name__ == "__main__":
    unittest.main()
