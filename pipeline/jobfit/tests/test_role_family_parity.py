"""Direction: guard-the-families — two cross-boundary guards over the role-family
vocabulary that were previously unguarded.

1. TS/Python parity. ``app/_lib/role-families.ts::ROLE_FAMILY_SLUGS`` is a
   hand-maintained TS copy of the Python benchmark family set (``ROLE_FAMILY_SET``).
   Currency is guarded this way (test_market_config.py::CrossBoundarySyncTest reads
   ``format.ts`` with a regex); the family vocabulary was not, so the two could
   silently drift — a family added on one side and forgotten on the other. This
   reads the TS source and asserts the two sets are equal in BOTH directions.

2. Floors == actuals for built-out families. ``SKILL_COVERAGE_FLOORS`` is a ratchet
   the coverage gate enforces with ``>=`` (catches a regression between commits). A
   floor set BELOW its live count is silent slack: the gate would then permit
   deleting vocabulary down to the floor unnoticed — exactly the finance_accounting
   case (floor 46 vs live 54, 8 deletable terms). This pins every NONZERO floor to
   the exact live count so slack can't reappear; ZERO floors are "not-yet-built"
   placeholders held as pure minimums per the convention documented alongside
   SKILL_COVERAGE_FLOORS.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit import taxonomy_check as tc
from pipeline.jobfit.taxonomy import DEFAULT_FAMILY, ROLE_FAMILY_SET

_REPO_ROOT = Path(__file__).resolve().parents[3]
_ROLE_FAMILIES_TS = _REPO_ROOT / "app" / "_lib" / "role-families.ts"


def _ts_role_family_slugs(text: str) -> set[str]:
    """The string literals inside ``ROLE_FAMILY_SLUGS = [ ... ] as const``."""
    block = re.search(r"ROLE_FAMILY_SLUGS\s*=\s*\[(.*?)\]\s*as const", text, re.DOTALL)
    assert block is not None, "could not find ROLE_FAMILY_SLUGS array in role-families.ts"
    return set(re.findall(r'"([^"]+)"', block.group(1)))


class RoleFamilyTsParityTest(unittest.TestCase):
    """The TS mirror of the family vocabulary must equal the Python source of truth."""

    def setUp(self) -> None:
        self.assertTrue(_ROLE_FAMILIES_TS.exists(), f"missing {_ROLE_FAMILIES_TS}")
        self.text = _ROLE_FAMILIES_TS.read_text(encoding="utf-8")

    def test_ts_slugs_equal_python_family_set_both_directions(self) -> None:
        ts = _ts_role_family_slugs(self.text)
        py = set(ROLE_FAMILY_SET)
        self.assertEqual(
            ts,
            py,
            "app/_lib/role-families.ts::ROLE_FAMILY_SLUGS drifted from the Python "
            f"ROLE_FAMILY_SET.\n  only in TS: {sorted(ts - py)}\n  only in Python: {sorted(py - ts)}",
        )

    def test_ts_default_family_matches_python(self) -> None:
        # The neutral fallback must agree too, or a non-detected family routes to a
        # different default on each side.
        m = re.search(r'DEFAULT_ROLE_FAMILY[^=]*=\s*"([^"]+)"', self.text)
        self.assertIsNotNone(m, "could not find DEFAULT_ROLE_FAMILY in role-families.ts")
        self.assertEqual(m.group(1), DEFAULT_FAMILY)


class SkillFloorExactPinTest(unittest.TestCase):
    """Nonzero floors are EXACT pins; slack (a floor below the live count) is a hole."""

    def setUp(self) -> None:
        self.counts = tc.skill_counts_by_family(tc.load_taxonomy())

    def test_nonzero_floors_equal_live_counts(self) -> None:
        slack = {
            fam: (floor, self.counts.get(fam, 0))
            for fam, floor in tc.SKILL_COVERAGE_FLOORS.items()
            if floor > 0 and self.counts.get(fam, 0) != floor
        }
        self.assertEqual(
            slack,
            {},
            "nonzero SKILL_COVERAGE_FLOORS must equal the live skill count (fam -> "
            f"(floor, actual)): {slack}. Re-pin the floor to the actual in the SAME "
            "commit that changed the vocabulary — a floor below actual is silent "
            "slack that would permit deleting terms down to it unnoticed.",
        )

    def test_zero_floors_are_genuine_placeholders(self) -> None:
        # A zero floor is only honest for a family that truly has no skill vocabulary
        # yet; if one grows terms it must graduate to an exact nonzero pin.
        for fam, floor in tc.SKILL_COVERAGE_FLOORS.items():
            if floor == 0:
                self.assertEqual(
                    self.counts.get(fam, 0),
                    0,
                    f"{fam} has a ZERO floor but {self.counts.get(fam, 0)} live skill "
                    "terms — replace the placeholder with an exact nonzero floor.",
                )


if __name__ == "__main__":
    unittest.main()
