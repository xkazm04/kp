from __future__ import annotations

import unittest

from pipeline.jobfit.insights import apply_company_salary_context, build_company_context
from pipeline.jobfit.models import SalaryEstimate
from pipeline.jobfit.salary_band import round_salary


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

    def test_company_factor_scales_an_off_centre_midpoint_instead_of_recentring_it(self) -> None:
        # The company factor shifts the WHOLE band by one multiplier, so the midpoint
        # must move by that multiplier too. It used to be re-derived as the mean of
        # the shifted bounds, which silently discarded a model-supplied midpoint —
        # pipeline._salary_from_payload keeps one whenever min <= midpoint <= max, and
        # a real estimate is frequently bottom-skewed. With a 90k-150k band and a 100k
        # midpoint the 1.11 enterprise factor produced 130k (+30%) instead of 110k
        # (+11%), moving the headline figure the recruiter negotiates against and the
        # group-eval over/within-band verdict computed from it.
        context = build_company_context("Large international corporate bank in Prague with strong benefits")
        assert context is not None
        factor = context.adjustment_factor
        salary = SalaryEstimate(
            currency="CZK", period="month",
            minimum=90000, maximum=150000, midpoint=100000,
            confidence="medium", rationale=[],
        )
        apply_company_salary_context(salary, context)
        self.assertEqual(salary.midpoint, round_salary(100000 * factor))
        # …and it stays where it belongs: off-centre, below the band's mean.
        self.assertLess(salary.midpoint, (salary.minimum + salary.maximum) / 2)
        # The band invariant the sanity checks assert still holds.
        self.assertTrue(0 < salary.minimum <= salary.midpoint <= salary.maximum)

    def test_centred_midpoint_is_unchanged_by_the_fix(self) -> None:
        # Regression guard: for the common case (midpoint == the band's mean, which is
        # what _salary_from_payload derives when the model supplies none) the scaled
        # midpoint is byte-identical to the old mean-of-shifted-bounds result.
        context = build_company_context("Large international corporate bank in Prague with strong benefits")
        assert context is not None
        salary = SalaryEstimate(
            currency="CZK", period="month",
            minimum=100000, maximum=150000, midpoint=125000,
            confidence="medium", rationale=[],
        )
        apply_company_salary_context(salary, context)
        self.assertEqual(salary.midpoint, round_salary((salary.minimum + salary.maximum) / 2))


if __name__ == "__main__":
    unittest.main()
