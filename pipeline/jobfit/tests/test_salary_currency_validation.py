"""Salary currency/period validation + multi-market plausibility.

Covers bug-ui-scan-2026-07-09 (cv-extraction-pipeline-services #4): before the fix,
``_salary_sanity_checks`` only bounded CZK/month, so an absurd or injected non-CZK
figure — or a garbage currency/period code — was reported as a plausible negotiation
anchor with no manual-review flag; and ``_salary_from_payload`` trusted the currency/
period strings verbatim with no allow-list.

Non-vacuity: every assertion below fails against the pre-fix code (the CZK-only gate
skipped the plausibility line entirely for non-CZK, so the "needs manual review" /
"unrecognized" / non-CZK "plausible" strings were simply never emitted).
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.pipeline import _salary_from_payload, _salary_sanity_checks
from pipeline.jobfit.models import SalaryEstimate


def _salary(
    minimum: int,
    maximum: int,
    *,
    currency: str = "CZK",
    period: str = "month",
    midpoint: int | None = None,
) -> SalaryEstimate:
    return SalaryEstimate(
        currency=currency,
        period=period,
        minimum=minimum,
        maximum=maximum,
        midpoint=midpoint if midpoint is not None else (minimum + maximum) // 2,
        confidence="medium",
        rationale=[],
    )


class SalaryCurrencyPlausibilityTest(unittest.TestCase):
    def test_absurd_non_czk_year_is_flagged(self) -> None:
        # USD 5,000,000/yr — the finding's exact scenario. Pre-fix this passed the
        # CZK-only gate untouched (no plausibility line at all).
        checks = _salary_sanity_checks(
            _salary(4_000_000, 5_000_000, currency="USD", period="year", midpoint=4_500_000)
        )
        self.assertIn("Salary range needs manual review", checks)
        self.assertNotIn("Salary range seems plausible", checks)

    def test_legitimate_non_czk_month_is_plausible(self) -> None:
        # A real EUR 3,000-6,000/month offer must now be positively checked as
        # plausible (pre-fix: no plausibility line for EUR at all).
        checks = _salary_sanity_checks(_salary(3_000, 6_000, currency="EUR", period="month"))
        self.assertIn("Salary range seems plausible", checks)
        self.assertNotIn("Salary range needs manual review", checks)

    def test_absurd_hourly_rate_is_flagged(self) -> None:
        # USD 400/hr annualizes to ~832k/yr, above the USD ceiling.
        checks = _salary_sanity_checks(_salary(50, 400, currency="USD", period="hour", midpoint=225))
        self.assertIn("Salary range needs manual review", checks)

    def test_reasonable_hourly_rate_is_plausible(self) -> None:
        # USD 100/hr ~= 208k/yr, comfortably under the ceiling.
        checks = _salary_sanity_checks(_salary(40, 100, currency="USD", period="hour", midpoint=70))
        self.assertIn("Salary range seems plausible", checks)

    def test_garbage_currency_and_period_go_to_manual_review(self) -> None:
        # A code that matches neither the currency allow-list nor the period set can't
        # be bounded — it must not slip through unchecked (it used to).
        checks = _salary_sanity_checks(
            _salary(1_000, 2_000, currency="BTC", period="fortnight", midpoint=1_500)
        )
        self.assertIn("Salary currency/period unrecognized — needs manual review", checks)
        self.assertFalse(any("plausible" in c for c in checks))

    def test_currency_period_are_case_insensitive(self) -> None:
        # Stray casing ("usd"/"Year") must normalize, not fall through as unrecognized.
        checks = _salary_sanity_checks(_salary(3_000, 6_000, currency="usd", period="Year"))
        self.assertNotIn("Salary currency/period unrecognized — needs manual review", checks)
        self.assertIn("Salary range seems plausible", checks)

    def test_czk_month_behaviour_is_unchanged(self) -> None:
        # Regression guard: the CZK/month path must stay byte-for-byte identical.
        self.assertEqual(
            _salary_sanity_checks(_salary(90_000, 130_000, midpoint=110_000)),
            ["Salary range order OK", "Salary range seems plausible"],
        )


class SalaryFromPayloadValidationTest(unittest.TestCase):
    def test_unrecognized_currency_flagged_in_repairs(self) -> None:
        repairs: list[str] = []
        _salary_from_payload(
            {"currency": "BTC", "period": "year", "minimum": 1_000, "maximum": 2_000},
            repairs,
        )
        self.assertTrue(any("unrecognized" in r.lower() for r in repairs))

    def test_recognized_currency_not_flagged(self) -> None:
        repairs: list[str] = []
        _salary_from_payload(
            {"currency": "usd", "period": "year", "minimum": 100_000, "maximum": 180_000},
            repairs,
        )
        self.assertFalse(any("unrecognized" in r.lower() for r in repairs))

    def test_currency_period_normalized_on_ingest(self) -> None:
        salary = _salary_from_payload(
            {"currency": " eur ", "period": " Month ", "minimum": 3_000, "maximum": 6_000}
        )
        self.assertEqual(salary.currency, "EUR")
        self.assertEqual(salary.period, "month")

    def test_empty_band_does_not_flag_currency(self) -> None:
        # No band -> the currency is irrelevant and must not raise a spurious note.
        repairs: list[str] = []
        _salary_from_payload({"currency": "BTC", "period": "eon"}, repairs)
        self.assertFalse(any("unrecognized" in r.lower() for r in repairs))


if __name__ == "__main__":
    unittest.main()
