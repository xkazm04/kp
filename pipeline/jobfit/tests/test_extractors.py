"""Regression tests for the text-extraction repair passes.

Pins the DoS bound on collapse_letter_spacing (bug-ui-scan 2026-06-20 critical): the
letter-spacing repair must stay cheap on adversarial multi-megabyte input — it backs
the public extract/apply path — while still repairing genuine letter-spaced CV text.
"""

from __future__ import annotations

import time
import unittest

from pipeline.jobfit.extractors import (
    MAX_REPAIR_CHARS,
    collapse_letter_spacing,
)


class CollapseLetterSpacingTest(unittest.TestCase):
    def test_repairs_genuine_letter_spacing(self) -> None:
        self.assertEqual(collapse_letter_spacing("K n o w l e d g e base"), "Knowledge base")
        # Compound term: inner spaces collapse, the surrounding ` - ` is preserved.
        self.assertEqual(collapse_letter_spacing("K n o w l e d g e - b a s e s"), "Knowledge - bases")

    def test_leaves_normal_text_untouched(self) -> None:
        normal = "Senior Backend Engineer with 8 years of experience."
        self.assertEqual(collapse_letter_spacing(normal), normal)

    def test_oversized_adversarial_input_is_bounded_and_fast(self) -> None:
        # ~2 MB of the exact pathology the repair targets, at extreme length.
        hostile = "a " * 1_000_000
        start = time.perf_counter()
        out = collapse_letter_spacing(hostile)
        elapsed = time.perf_counter() - start
        # Only the leading window is repaired; the tail passes through verbatim, so the
        # result keeps (most of) the original length rather than collapsing to nothing.
        self.assertGreater(len(out), len(hostile) - MAX_REPAIR_CHARS)
        # Must not pin the CPU — a generous ceiling that a linear-but-capped pass clears
        # by orders of magnitude (observed ~0.01s), while an unbounded pass would not.
        self.assertLess(elapsed, 2.0, f"repair took {elapsed:.3f}s on 2 MB — DoS bound not holding")


if __name__ == "__main__":
    unittest.main()
