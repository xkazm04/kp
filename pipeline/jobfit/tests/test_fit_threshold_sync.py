"""Guard the cross-language FIT-BAND coupling.

``pipeline/jobfit/matching.py`` owns the three-tier fit scale that the SCORER
produces (``FIT_STRONG_THRESHOLD`` / ``FIT_PROMISING_THRESHOLD``). The TS side
re-declares the same two numbers in ``app/_lib/fit-thresholds.ts`` because the
values must be readable from a client component without spawning Python — and
that file's own comment says to "keep the Python constant in sync BY HAND across
the boundary".

By hand is exactly the arrangement that ``test_prompt_version_sync.py`` exists to
end for the eight prompt versions. The consequence here is quieter but the same
shape: the Python scorer bands a total into strong/promising/weak and stamps a
``fitTier`` onto its output, while the TS floors drive the rediscovery admission
gate, the Candidates "Pool fit" filter, the group-eval low-fit risk and
``scoreToFitTier`` — the badge a recruiter reads when the server emitted no tier.
Move one side alone and the SAME candidate is "promising" to the gate that admits
them and "weak" to the badge beside their name, with nothing red anywhere.

This binds both floors in both directions, enumerated from the two sources so a
tier added on either side without the other reddens the build.
"""

import re
import unittest
from pathlib import Path
from typing import get_args

from pipeline.jobfit import matching

REPO_ROOT = Path(__file__).resolve().parents[3]
FIT_THRESHOLDS_TS = REPO_ROOT / "app" / "_lib" / "fit-thresholds.ts"

# TS constant -> the Python constant that must equal it. Explicit so BOTH
# directions are checkable; see :meth:`test_the_map_covers_both_sides`.
FIT_FLOOR_CONSTANTS = {
    "FIT_STRONG_FLOOR": "FIT_STRONG_THRESHOLD",
    "FIT_PROMISING_FLOOR": "FIT_PROMISING_THRESHOLD",
}


def _strip_ts_comments(text: str) -> str:
    """Drop // line and /* */ block comments.

    The live file is heavily commented AND its prose names both numbers ("Mirrors
    pipeline/jobfit/matching.py's FIT_PROMISING_THRESHOLD"), so an extractor that
    did not strip comments could read a documented value instead of the shipped
    one. Same hazard, same fix, as test_prompt_version_sync.py.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def _extract_ts_number(text: str, name: str) -> int:
    """The integer literal exported as ``name``.

    ``name`` is word-anchored so ``FIT_PROMISING_FLOOR`` cannot be satisfied by a
    hypothetical ``LEGACY_FIT_PROMISING_FLOOR``.
    """
    match = re.search(rf"\b{re.escape(name)}\s*=\s*(\d+)", _strip_ts_comments(text))
    if not match:
        raise AssertionError(f"could not find `{name}` numeric literal in {FIT_THRESHOLDS_TS}")
    return int(match.group(1))


class FitThresholdSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(FIT_THRESHOLDS_TS.exists(), f"missing {FIT_THRESHOLDS_TS}")
        self.ts_source = FIT_THRESHOLDS_TS.read_text(encoding="utf-8")

    def test_every_floor_matches_the_python_threshold(self) -> None:
        for ts_name, py_name in FIT_FLOOR_CONSTANTS.items():
            with self.subTest(floor=ts_name):
                self.assertEqual(
                    _extract_ts_number(self.ts_source, ts_name),
                    getattr(matching, py_name),
                    f"fit-thresholds.ts {ts_name} drifted from matching.{py_name} — move "
                    "BOTH together, or the scorer's tier and the recruiter's badge band "
                    "the same candidate differently.",
                )

    def test_the_map_covers_both_sides(self) -> None:
        # A tier added on either side without the other must redden this, exactly as
        # the prompt-version lockstep does for the eight cached prompts.
        py_consts = {n for n in dir(matching) if n.startswith("FIT_") and n.endswith("_THRESHOLD")}
        self.assertEqual(
            py_consts,
            set(FIT_FLOOR_CONSTANTS.values()),
            "matching.py exports a FIT_*_THRESHOLD with no fit-thresholds.ts counterpart "
            "(or vice versa)",
        )
        ts_consts = set(re.findall(r"export const (FIT_\w+_FLOOR)\b", _strip_ts_comments(self.ts_source)))
        self.assertEqual(
            ts_consts,
            set(FIT_FLOOR_CONSTANTS),
            "fit-thresholds.ts exports a FIT_*_FLOOR this map does not bind",
        )

    def test_the_band_is_ordered_on_both_sides(self) -> None:
        self.assertGreater(matching.FIT_STRONG_THRESHOLD, matching.FIT_PROMISING_THRESHOLD)
        self.assertGreater(
            _extract_ts_number(self.ts_source, "FIT_STRONG_FLOOR"),
            _extract_ts_number(self.ts_source, "FIT_PROMISING_FLOOR"),
        )

    def test_the_python_bander_actually_uses_these_constants(self) -> None:
        # Non-vacuity on the Python side: the equality above is only worth anything
        # if matching.py's own banding reads the constants it exports. Probe the
        # real function at the two boundaries rather than trusting the names.
        band = getattr(matching, "fit_tier_for", None)
        self.assertIsNotNone(band, "matching.py must expose the banding function")
        self.assertEqual(band(matching.FIT_STRONG_THRESHOLD), "strong")
        self.assertEqual(band(matching.FIT_STRONG_THRESHOLD - 1), "promising")
        self.assertEqual(band(matching.FIT_PROMISING_THRESHOLD), "promising")
        self.assertEqual(band(matching.FIT_PROMISING_THRESHOLD - 1), "partial")

    def test_the_tier_VOCABULARY_matches_too(self) -> None:
        # Numbers in lockstep are not enough: the two banders must also agree on what
        # they CALL each band. scoreToFitTier (Badge.tsx) is the client-side fallback
        # for a score the server sent with no fitTier, and FitTierBadge keys its
        # colour/label/icon off the string — so a tier renamed on one side alone is a
        # band that renders as nothing at all.
        badge_ts = (REPO_ROOT / "app" / "_components" / "Badge.tsx").read_text(encoding="utf-8")
        start = badge_ts.index("export function scoreToFitTier")
        body = badge_ts[start : badge_ts.index(chr(10) + "}", start)]
        self.assertEqual(set(re.findall(r'return "(\w+)"', body)), {"strong", "promising", "partial"})
        self.assertEqual(set(get_args(matching.FitTier)), {"strong", "promising", "partial"})


class ExtractTsNumberTest(unittest.TestCase):
    """Non-vacuous guards for the extractor itself — constructed inputs, so a
    regression to a comment-fragile or unanchored form fails here."""

    def test_reads_the_live_value_not_a_commented_one(self) -> None:
        self.assertEqual(_extract_ts_number('// export const X = 99\nexport const X = 55;', "X"), 55)
        self.assertEqual(_extract_ts_number('/* X = 99 */\nexport const X = 55;', "X"), 55)

    def test_prose_mentioning_the_name_does_not_win(self) -> None:
        # The real file's doc comment names both constants; a comment saying
        # "X = 99" must not be read as the shipped value.
        self.assertEqual(_extract_ts_number('// Mirrors X = 99\nexport const X = 70;', "X"), 70)

    def test_word_boundary_prevents_prefix_false_match(self) -> None:
        with self.assertRaises(AssertionError):
            _extract_ts_number("export const LEGACY_X = 5;", "X")

    def test_missing_constant_is_an_error_not_a_silent_zero(self) -> None:
        with self.assertRaises(AssertionError):
            _extract_ts_number("export const OTHER = 5;", "X")


if __name__ == "__main__":
    unittest.main()
