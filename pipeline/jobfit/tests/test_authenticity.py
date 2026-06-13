from __future__ import annotations

import unittest

from pipeline.jobfit.authenticity import authenticity_band, authenticity_checks


class AuthenticityTest(unittest.TestCase):
    def test_clean_cv_passes(self) -> None:
        cv = (
            "Backend engineer. Led the payments platform 2019-2024, cut p99 latency 40%, "
            "scaled to 12M requests/day. Shipped Go and Python services with 85% test coverage."
        )
        checks = authenticity_checks(cv, skills_count=8, years_experience=8)
        self.assertEqual(len(checks), 1)
        self.assertTrue(checks[0].startswith("Authenticity"))
        self.assertNotIn("manual review", checks[0])
        self.assertEqual(authenticity_band(checks), "high")

    def test_buzzword_heavy_cv_flags(self) -> None:
        cv = (
            "A passionate, results-driven team player and self-starter. A proactive, "
            "detail-oriented thought leader with a proven track record who can hit the ground "
            "running and move the needle in any fast-paced environment."
        )
        checks = authenticity_checks(cv, skills_count=5, years_experience=5)
        self.assertTrue(any("buzzword" in c for c in checks))
        self.assertIn(authenticity_band(checks), ("medium", "low"))

    def test_implausible_years_flags(self) -> None:
        checks = authenticity_checks("Seasoned professional.", skills_count=3, years_experience=60)
        self.assertTrue(any("career span" in c for c in checks))

    def test_skill_stuffing_flags(self) -> None:
        checks = authenticity_checks("Engineer.", skills_count=30, years_experience=4)
        self.assertTrue(any("skill list" in c for c in checks))

    def test_long_cv_without_numbers_flags_few_specifics(self) -> None:
        cv = "Experienced leader. " * 120  # long, zero digits
        checks = authenticity_checks(cv, skills_count=5, years_experience=10)
        self.assertTrue(any("concrete dates" in c for c in checks))

    def test_band_thresholds(self) -> None:
        self.assertEqual(authenticity_band(["Authenticity checks passed — language reads specific and concrete."]), "high")
        self.assertEqual(authenticity_band(["Authenticity: x (manual review)."]), "medium")
        self.assertEqual(
            authenticity_band(["Authenticity: x (manual review).", "Authenticity: y (manual review)."]), "low"
        )


if __name__ == "__main__":
    unittest.main()
