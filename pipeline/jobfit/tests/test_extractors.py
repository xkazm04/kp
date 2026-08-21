"""Regression tests for the text-extraction repair passes.

Pins the DoS bound on collapse_letter_spacing (bug-ui-scan 2026-06-20 critical): the
letter-spacing repair must stay cheap on adversarial multi-megabyte input — it backs
the public extract/apply path — while still repairing genuine letter-spaced CV text.

Also pins the .txt/.md DECODE contract: those uploads used to be read as UTF-8 with
``errors="ignore"``, which silently deleted every diacritic of a legacy cp1250
("save as ANSI") Czech CV before any downstream pass ever saw it.
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from pipeline.jobfit.extractors import (
    MAX_REPAIR_CHARS,
    collapse_letter_spacing,
    extract_text,
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


CZECH_CV = "Jiří Řezáč\nSenior vývojář, Česká spořitelna\nZkušenosti: 8 let, tým 5 lidí\n"


class PlainTextDecodingTest(unittest.TestCase):
    """A .txt/.md CV must survive whatever code page it was saved in.

    The Czech market is the primary case and a Windows "ANSI" save is cp1250; the
    previous UTF-8 + ``errors="ignore"`` read dropped every non-UTF-8 byte, so the
    recruiter's name/company/skill passes — and, in blind mode, the redacted text
    actually sent to the model — ran on "Ji ez, esk spoitelna".
    """

    def _written(self, data: bytes, name: str = "cv.txt") -> str:
        path = Path(tempfile.mkdtemp()) / name
        path.write_bytes(data)
        return extract_text(path)

    def test_utf8_is_unchanged(self) -> None:
        self.assertEqual(self._written(CZECH_CV.encode("utf-8")), CZECH_CV)

    def test_cp1250_czech_keeps_its_diacritics(self) -> None:
        self.assertEqual(self._written(CZECH_CV.encode("cp1250")), CZECH_CV)

    def test_markdown_takes_the_same_path(self) -> None:
        self.assertEqual(self._written(CZECH_CV.encode("cp1250"), "cv.md"), CZECH_CV)

    def test_utf8_bom_is_consumed(self) -> None:
        # A stray U+FEFF glued to the first line defeats the top-of-document name
        # heuristics (redact._guess_name_line tokenizes that line).
        self.assertEqual(self._written(CZECH_CV.encode("utf-8-sig")), CZECH_CV)

    def test_cp1252_western_accents_win_the_tie(self) -> None:
        # A French CV scores 0 Czech letters under BOTH ANSI pages, so cp1252 must
        # take the tie — decoding it as cp1250 would turn "è"/"à" into "č"/"ŕ".
        french = "Ingénieur logiciel\nDéveloppeur à Paris, très à l'aise en équipe\n"
        self.assertEqual(self._written(french.encode("cp1252")), french)

    def test_undecodable_bytes_still_return_text(self) -> None:
        # latin-1 backstop: never raise on the public extract path.
        self.assertIn("CV", self._written(b"CV \x81\x8d\x90 body"))


if __name__ == "__main__":
    unittest.main()
