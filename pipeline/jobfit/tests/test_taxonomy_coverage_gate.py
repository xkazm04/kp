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

    def test_parent_coverage_does_not_regress(self) -> None:
        # Parent links are what make sibling / graded-fallback credit possible; losing
        # them silently drops a family back to 0/1 string equality.
        counts = tc.parent_counts_by_family(self.taxonomy)
        for family, floor in tc.PARENT_COVERAGE_FLOORS.items():
            self.assertGreaterEqual(
                counts.get(family, 0),
                floor,
                f"parent-link coverage for {family!r} fell to {counts.get(family, 0)} "
                f"below its floor of {floor}. If this drop is intentional, LOWER the "
                f"floor in taxonomy_check.PARENT_COVERAGE_FLOORS in the same commit.",
            )

    def test_every_family_has_a_recorded_parent_floor(self) -> None:
        for family in tc.ROLE_FAMILIES:
            self.assertIn(
                family,
                tc.PARENT_COVERAGE_FLOORS,
                f"role family {family!r} has no floor in PARENT_COVERAGE_FLOORS",
            )

    def test_tech_parent_coverage_reaches_non_tech_parity(self) -> None:
        # The headline of tech-hierarchy-parity: the three tech families are no longer
        # the WORST-connected in the graph. Pinned as a ratio so growing a family's
        # vocabulary without linking it reddens the build.
        rows = {r.family: r for r in tc.coverage_by_family(self.taxonomy)}
        for family in ("software_engineering", "data_ai", "product_project"):
            self.assertGreaterEqual(
                rows[family].pct_parents, 50.0,
                f"{family} parent coverage fell to {rows[family].pct_parents:.0f}% "
                "— below the non-tech-comparable 50% target.",
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
