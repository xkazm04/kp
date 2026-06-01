"""Golden-set eval scoring: salary coverage vs accuracy.

A missing Gemini salary used to coerce to ``(0, 0)`` and score
``_range_overlap((0, 0), expected) == 0.0`` — identical to a confidently-wrong
band. The aggregate ``salary_overlap`` could then not tell a *coverage* failure
(no salary emitted) from an *accuracy* failure (wrong band). These tests pin the
split: a per-fixture ``salary_present`` flag, ``salary_coverage`` in the
aggregate, and ``salary_overlap`` averaged only over fixtures that emitted a
band. No API key required — fixtures are constructed directly.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.runner import (
    GLYPH_NA,
    FixtureResult,
    Report,
    _fixture_passed,
    _salary_band,
    _salary_cell,
)
from pipeline.jobfit.eval.thresholds import PASS_THRESHOLDS


def _fixture(
    name: str = "f",
    *,
    salary_overlap: float = 1.0,
    salary_present: bool = True,
    error: str | None = None,
    role: bool = True,
    sen: bool = True,
    skill: float = 1.0,
    edu: bool | None = None,
) -> FixtureResult:
    """A FixtureResult with every axis passing by default; tweak one per test."""
    return FixtureResult(
        name=name,
        label=name,
        duration_s=0.0,
        role_family_match=role,
        seniority_match=sen,
        salary_overlap=salary_overlap,
        salary_present=salary_present,
        skill_recall=skill,
        education_match=edu,
        signals_recall=None,
        actual={},
        expected={},
        error=error,
    )


class SalaryBandTest(unittest.TestCase):
    def test_real_band_is_present(self) -> None:
        self.assertEqual(_salary_band({"minimum": 50000, "maximum": 70000}), (50000, 70000, True))

    def test_string_numbers_are_present(self) -> None:
        self.assertEqual(_salary_band({"minimum": "50000", "maximum": "70000"}), (50000, 70000, True))

    def test_partial_band_is_present(self) -> None:
        # Only one bound emitted still counts as a salary signal (coverage hit).
        self.assertEqual(_salary_band({"minimum": 60000}), (60000, 0, True))

    def test_missing_block_is_absent(self) -> None:
        self.assertEqual(_salary_band({}), (0, 0, False))

    def test_non_dict_is_absent(self) -> None:
        # payload {"salary": null} → None must not raise, just read as absent.
        self.assertEqual(_salary_band(None), (0, 0, False))

    def test_null_bounds_are_absent(self) -> None:
        self.assertEqual(_salary_band({"minimum": None, "maximum": None}), (0, 0, False))

    def test_garbage_bounds_are_absent(self) -> None:
        self.assertEqual(_salary_band({"minimum": "n/a", "maximum": "?"}), (0, 0, False))

    def test_zero_band_is_absent(self) -> None:
        # An explicit 0/0 is no salary, not a (wrong) band of zero.
        self.assertEqual(_salary_band({"minimum": 0, "maximum": 0}), (0, 0, False))


class AggregateSplitTest(unittest.TestCase):
    def test_missing_salary_excluded_from_overlap_average(self) -> None:
        # 2 emitted (overlap 1.0 and 0.0) + 2 missing. Old behaviour folded the
        # missing into the mean → 0.25. New: overlap averages emitted only (0.5),
        # coverage reports the 2/4 emission rate separately.
        report = Report(fixtures=[
            _fixture("a", salary_overlap=1.0, salary_present=True),
            _fixture("b", salary_overlap=0.0, salary_present=True),
            _fixture("c", salary_overlap=0.0, salary_present=False),
            _fixture("d", salary_overlap=0.0, salary_present=False),
        ])
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_overlap"], 0.5)
        self.assertAlmostEqual(agg["salary_coverage"], 0.5)

    def test_missing_and_wrong_are_distinguished(self) -> None:
        # One coverage miss, one accuracy miss — both 0.0 per-fixture overlap, but
        # only the wrong band counts toward the overlap average.
        report = Report(fixtures=[
            _fixture("missing", salary_overlap=0.0, salary_present=False),
            _fixture("wrong", salary_overlap=0.0, salary_present=True),
        ])
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_coverage"], 0.5)
        self.assertAlmostEqual(agg["salary_overlap"], 0.0)  # the one emitted band was wrong

    def test_full_coverage_averages_all(self) -> None:
        report = Report(fixtures=[
            _fixture("a", salary_overlap=1.0, salary_present=True),
            _fixture("b", salary_overlap=0.8, salary_present=True),
        ])
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_overlap"], 0.9)
        self.assertAlmostEqual(agg["salary_coverage"], 1.0)

    def test_no_emission_is_zero_coverage_not_silent(self) -> None:
        report = Report(fixtures=[_fixture(salary_present=False) for _ in range(3)])
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_coverage"], 0.0)
        self.assertAlmostEqual(agg["salary_overlap"], 0.0)

    def test_error_fixtures_excluded_from_both_axes(self) -> None:
        # An analysis crash is surfaced under Errors, not counted as a coverage or
        # accuracy miss: coverage/overlap reflect only the one fixture that ran.
        report = Report(fixtures=[
            _fixture("ok", salary_overlap=1.0, salary_present=True),
            _fixture("boom", salary_overlap=0.0, salary_present=False, error="kaboom"),
        ])
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_coverage"], 1.0)
        self.assertAlmostEqual(agg["salary_overlap"], 1.0)


class GatingTest(unittest.TestCase):
    def test_low_coverage_fails_even_with_perfect_accuracy(self) -> None:
        # 1 emitted, perfect overlap; 9 missing. Accuracy reads 100% but coverage
        # is 10% — the gate must fail on coverage, not be fooled by the accuracy.
        fixtures = [_fixture("hit", salary_overlap=1.0, salary_present=True)]
        fixtures += [_fixture(f"miss{i}", salary_present=False) for i in range(9)]
        report = Report(fixtures=fixtures)
        agg = report.aggregate()
        self.assertAlmostEqual(agg["salary_overlap"], 1.0)
        self.assertLess(agg["salary_coverage"], PASS_THRESHOLDS["salary_coverage"])
        self.assertFalse(report.passes())

    def test_full_coverage_and_accuracy_passes(self) -> None:
        report = Report(fixtures=[_fixture("good", salary_overlap=1.0, salary_present=True)])
        self.assertTrue(report.passes())


class PerFixtureTest(unittest.TestCase):
    def test_missing_salary_fails_fixture(self) -> None:
        # Everything else perfect, but no salary emitted → fixture fails (coverage).
        self.assertFalse(_fixture_passed(_fixture(salary_present=False)))

    def test_present_band_above_threshold_passes(self) -> None:
        self.assertTrue(_fixture_passed(_fixture(salary_overlap=1.0, salary_present=True)))

    def test_salary_cell_marks_missing_distinctly(self) -> None:
        cell = _salary_cell(_fixture(salary_overlap=0.0, salary_present=False))
        self.assertIn(GLYPH_NA, cell)
        self.assertIn("none", cell)
        self.assertNotIn("%", cell)  # never a 0% that reads like a wrong band

    def test_salary_cell_shows_percentage_when_present(self) -> None:
        self.assertEqual(_salary_cell(_fixture(salary_overlap=0.5, salary_present=True)), "50%")


if __name__ == "__main__":
    unittest.main()
