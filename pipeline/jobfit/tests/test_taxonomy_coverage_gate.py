"""CI gate: the LIVE taxonomy must pass the lint and never regress coverage.

Two guarantees:
1. ``data/taxonomy.json`` lints clean (zero errors) against the real families /
   salary signals — the authoring harness is only useful if the shipped data
   satisfies it.
2. Per-family SKILL coverage never drops below the recorded floors in
   :data:`taxonomy_check.SKILL_COVERAGE_FLOORS`. Direction 2 RAISES these floors;
   any future edit that deletes a family's skill vocabulary reddens the build.

Also pins the checked-in coverage doc to the generator so it can't drift.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy_check as tc


class CoverageGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.taxonomy = tc.load_taxonomy()

    def test_live_taxonomy_lints_clean(self) -> None:
        result = tc.lint_taxonomy(self.taxonomy)
        self.assertTrue(
            result.ok,
            "data/taxonomy.json has lint ERRORS:\n  " + "\n  ".join(result.errors),
        )

    def test_skill_coverage_does_not_regress(self) -> None:
        counts = tc.skill_counts_by_family(self.taxonomy)
        for family, floor in tc.SKILL_COVERAGE_FLOORS.items():
            self.assertGreaterEqual(
                counts.get(family, 0),
                floor,
                f"skill-term coverage for {family!r} fell to {counts.get(family, 0)} "
                f"below its floor of {floor}. If this drop is intentional, LOWER the "
                f"floor in taxonomy_check.SKILL_COVERAGE_FLOORS in the same commit.",
            )

    def test_every_family_has_a_recorded_floor(self) -> None:
        # A new benchmark family must get an explicit floor (even 0), so nobody adds
        # a family and forgets to instrument its coverage.
        for family in tc.ROLE_FAMILIES:
            self.assertIn(
                family,
                tc.SKILL_COVERAGE_FLOORS,
                f"role family {family!r} has no floor in SKILL_COVERAGE_FLOORS",
            )

    def test_coverage_doc_is_fresh(self) -> None:
        self.assertTrue(
            tc.COVERAGE_REPORT_PATH.exists(),
            f"missing {tc.COVERAGE_REPORT_PATH} — run --write-report",
        )
        expected = tc.render_coverage_report(self.taxonomy)
        actual = tc.COVERAGE_REPORT_PATH.read_text(encoding="utf-8")
        self.assertEqual(
            actual,
            expected,
            "docs/TAXONOMY_COVERAGE.md is stale — regenerate with "
            "`python -m pipeline.jobfit.taxonomy_check --write-report`.",
        )


if __name__ == "__main__":
    unittest.main()
