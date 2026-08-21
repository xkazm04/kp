from __future__ import annotations

import unittest

from pipeline.jobfit.pipeline import _salary_from_payload, _salary_sanity_checks
from pipeline.jobfit.models import SalaryEstimate
from pipeline.jobfit.salary_band import SALARY_PLAUSIBILITY_CEILING


def _salary(minimum: int, maximum: int, midpoint: int | None = None) -> SalaryEstimate:
    return SalaryEstimate(
        currency="CZK",
        period="month",
        minimum=minimum,
        maximum=maximum,
        midpoint=midpoint if midpoint is not None else (minimum + maximum) // 2,
        confidence="medium",
        rationale=[],
    )


class SalarySanityCheckTest(unittest.TestCase):
    """The empty / inconsistent / implausible salary states must stay distinct —
    a CV with no comp signal is NOT a broken range and must not be mislabelled."""

    def test_no_estimate_is_its_own_state_not_inconsistent(self) -> None:
        # Gemini returned no salary -> _salary_from_payload yields 0/0.
        salary = _salary_from_payload({})
        self.assertEqual((salary.minimum, salary.maximum), (0, 0))

        checks = _salary_sanity_checks(salary)
        self.assertEqual(checks, ["No salary estimate produced"])
        # The empty case must NOT borrow the inconsistent/plausible vocabulary.
        self.assertNotIn("Salary range is inconsistent", checks)
        self.assertFalse(any("plausible" in c for c in checks))

    def test_valid_range_is_order_ok_and_plausible(self) -> None:
        checks = _salary_sanity_checks(_salary(90000, 130000, 110000))
        self.assertEqual(checks, ["Salary range order OK", "Salary range seems plausible"])

    def test_populated_but_broken_range_is_inconsistent(self) -> None:
        # Min above max with a midpoint outside the range — a genuine breakage,
        # distinct from the empty case above.
        checks = _salary_sanity_checks(_salary(130000, 90000, 110000))
        self.assertIn("Salary range is inconsistent", checks)
        self.assertNotIn("No salary estimate produced", checks)

    def test_above_ceiling_needs_manual_review(self) -> None:
        checks = _salary_sanity_checks(
            _salary(SALARY_PLAUSIBILITY_CEILING, SALARY_PLAUSIBILITY_CEILING + 5000)
        )
        self.assertIn("Salary range needs manual review", checks)

    def test_ceiling_is_inclusive(self) -> None:
        checks = _salary_sanity_checks(
            _salary(100000, SALARY_PLAUSIBILITY_CEILING, SALARY_PLAUSIBILITY_CEILING)
        )
        self.assertIn("Salary range seems plausible", checks)


class OneSidedBandIsFlaggedTest(unittest.TestCase):
    """A half-populated band is REPAIRED into a zero-width one; both directions
    must say so, or the recruiter negotiates against a derived endpoint that reads
    like an estimate and passes every check clean."""

    def test_missing_maximum_is_recorded(self) -> None:
        repairs: list[str] = []
        salary = _salary_from_payload({"minimum": 60000, "maximum": 0}, repairs)
        self.assertEqual((salary.minimum, salary.maximum), (60000, 60000))
        self.assertEqual(repairs, ["Salary maximum missing — set to minimum (manual review)"])

    def test_missing_minimum_is_recorded(self) -> None:
        repairs: list[str] = []
        salary = _salary_from_payload({"minimum": 0, "maximum": 80000}, repairs)
        self.assertEqual((salary.minimum, salary.maximum), (80000, 80000))
        self.assertEqual(repairs, ["Salary minimum missing — set to maximum (manual review)"])

    def test_a_complete_band_records_nothing(self) -> None:
        repairs: list[str] = []
        _salary_from_payload({"minimum": 60000, "maximum": 80000}, repairs)
        self.assertEqual(repairs, [])


if __name__ == "__main__":
    unittest.main()
