"""Guard the automation constants that are hand-mirrored into TypeScript.

Three numbers in this package say "MUST match the TS side" in a COMMENT and
nothing more, while the rubric set beside them is single-sourced from JSON and
the fit floors are pinned by ``test_fit_threshold_sync.py``. A comment is not a
gate: move one side alone and the two languages silently disagree.

  * ``automation.MAX_SCORECARD_NOTES_CHARS`` vs ``MAX_SCORECARD_NOTES_CHARS`` in
    ``app/_lib/interview-transcript.ts`` — the transcript budget handed to the
    scorecard prompt. The TS side samples FIRST, so if TS grows past Python's
    limit every TS-produced note is re-sampled here (double elision, the closing
    read-back cut twice); if TS shrinks below it, Python's own sampling never
    fires for a TS caller and the guarantee that the elision announces itself
    stops being checked on the path that actually runs.
  * ``calibration_drift.MIN_CALIBRATION_OUTCOMES`` and
    ``CALIBRATION_BIN_COUNT`` vs ``app/_lib/calibration.ts`` — the drift alarm
    consumes payloads the TS engine emits verbatim. A bin-count disagreement
    makes the PSI comparison read bins that describe different score ranges (no
    error, just a wrong number); a min-outcomes disagreement makes Python call
    "drift" on a window TS itself considers uncalibrated, i.e. an alarm computed
    on noise — the exact honesty failure calibration_drift's docstring forbids.

Same extraction shape as ``test_fit_threshold_sync.py``: read the TS source,
strip comments first (both files NAME the mirrored constants in prose), and
word-anchor the lookup.
"""

from __future__ import annotations

import inspect
import re
import unittest
from pathlib import Path

from pipeline.jobfit import automation, calibration_drift

REPO_ROOT = Path(__file__).resolve().parents[3]
TRANSCRIPT_TS = REPO_ROOT / "app" / "_lib" / "interview-transcript.ts"
CALIBRATION_TS = REPO_ROOT / "app" / "_lib" / "calibration.ts"

# TS file -> {TS constant: the Python value it must equal}. Explicit so the map
# itself is checkable (see test_the_map_names_live_python_constants).
MIRRORED: dict[Path, dict[str, int]] = {
    TRANSCRIPT_TS: {"MAX_SCORECARD_NOTES_CHARS": automation.MAX_SCORECARD_NOTES_CHARS},
    CALIBRATION_TS: {
        "MIN_CALIBRATION_OUTCOMES": calibration_drift.MIN_CALIBRATION_OUTCOMES,
        "CALIBRATION_BIN_COUNT": calibration_drift.CALIBRATION_BIN_COUNT,
    },
}


def _strip_ts_comments(text: str) -> str:
    """Drop // line and /* */ block comments.

    Both files document the mirror in prose that names the constant AND its
    value, so an extractor that did not strip comments could read a documented
    number instead of the shipped one.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def _extract_ts_number(text: str, name: str, source: Path) -> int:
    """The integer literal exported as ``name``, word-anchored so a longer name
    (``MIN_CALIBRATION_BAND_OUTCOMES``) cannot satisfy a shorter one."""
    match = re.search(rf"\bexport const {re.escape(name)}\s*=\s*(\d+)\s*;", _strip_ts_comments(text))
    if not match:
        raise AssertionError(f"could not find `export const {name} = <int>;` in {source}")
    return int(match.group(1))


class AutomationConstantSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources: dict[Path, str] = {}
        for path in MIRRORED:
            self.assertTrue(path.exists(), f"missing {path}")
            self.sources[path] = path.read_text(encoding="utf-8")

    def test_every_mirrored_constant_matches_the_python_value(self) -> None:
        for path, pairs in MIRRORED.items():
            for name, python_value in pairs.items():
                with self.subTest(ts=path.name, constant=name):
                    self.assertEqual(
                        _extract_ts_number(self.sources[path], name, path),
                        python_value,
                        f"{name} disagrees across the language boundary: {path} vs the Python mirror. "
                        "Move BOTH or neither.",
                    )

    def test_the_map_names_live_python_constants(self) -> None:
        # A rename on the Python side must not quietly leave the map checking a
        # value nothing reads any more.
        self.assertEqual(
            inspect.signature(automation.sample_scorecard_notes).parameters["limit"].default,
            automation.MAX_SCORECARD_NOTES_CHARS,
            "sample_scorecard_notes no longer defaults to the mirrored budget",
        )
        self.assertEqual(
            len(calibration_drift.compute_calibration([{"score": 50, "outcome": 1}] * 25)["bins"]),
            calibration_drift.CALIBRATION_BIN_COUNT,
            "compute_calibration no longer emits CALIBRATION_BIN_COUNT bins",
        )

    def test_extractor_rejects_a_documented_value(self) -> None:
        # The mutation guard for the guard: a value that appears ONLY in a comment
        # must not be readable, and a real declaration must be.
        fake = "// export const MAX_SCORECARD_NOTES_CHARS = 1;\nexport const MAX_SCORECARD_NOTES_CHARS = 7;\n"
        self.assertEqual(_extract_ts_number(fake, "MAX_SCORECARD_NOTES_CHARS", TRANSCRIPT_TS), 7)
        with self.assertRaises(AssertionError):
            _extract_ts_number("/* export const NOPE = 3; */", "NOPE", TRANSCRIPT_TS)


if __name__ == "__main__":
    unittest.main()
