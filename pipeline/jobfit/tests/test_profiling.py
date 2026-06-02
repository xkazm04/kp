"""Pins the present-year anchor used when estimating years of experience.

Ongoing roles (present/now/současnost/dosud) and the interval clamp ceiling are
anchored to a reference year that must follow the system clock, not a literal.
A hardcoded year silently drops a year of experience from every still-running
role once the calendar rolls past it, which then skews seniority inference and
the salary anchor band. These tests lock the rollover behavior in place.
"""

from __future__ import annotations

import unittest
from datetime import date

from pipeline.jobfit.profiling import _estimate_years, build_profile, present_year


class PresentYearAnchorTest(unittest.TestCase):
    def test_present_year_reads_system_clock(self) -> None:
        # The anchor must track the clock so it rolls over automatically.
        self.assertEqual(present_year(), date.today().year)

    def test_ongoing_role_anchored_to_as_of(self) -> None:
        years = _estimate_years("acme 2020 - present", as_of=2026)
        self.assertEqual(years, 6.0)

    def test_ongoing_role_rolls_over_with_the_year(self) -> None:
        # The regression guard: the same still-running role must gain a year as
        # the anchor advances, instead of staying frozen at a hardcoded ceiling.
        self.assertEqual(_estimate_years("acme 2020 - present", as_of=2026), 6.0)
        self.assertEqual(_estimate_years("acme 2020 - present", as_of=2027), 7.0)
        self.assertEqual(_estimate_years("acme 2020 - present", as_of=2030), 10.0)

    def test_czech_present_tokens_use_the_anchor(self) -> None:
        self.assertEqual(_estimate_years("acme 2021 - dosud", as_of=2026), 5.0)
        self.assertEqual(_estimate_years("acme 2021 - současnost", as_of=2027), 6.0)

    def test_future_end_year_clamped_to_anchor(self) -> None:
        # An explicit end year past the anchor (e.g. an expected graduation) is
        # clamped to the present so no interval claims future experience.
        self.assertEqual(_estimate_years("acme 2010 - 2030", as_of=2026), 16.0)

    def test_build_profile_threads_as_of(self) -> None:
        self.assertEqual(build_profile("acme 2020 - present", as_of=2027).years_experience, 7.0)

    def test_build_profile_default_uses_present_year(self) -> None:
        # No explicit as_of must behave identically to pinning the live clock,
        # proving the default path is sourced from present_year() not a literal.
        text = "acme 2021 - present"
        self.assertEqual(
            build_profile(text).years_experience,
            build_profile(text, as_of=present_year()).years_experience,
        )


if __name__ == "__main__":
    unittest.main()
