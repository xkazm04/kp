"""Regression tests for the text-extraction repair passes.

Pins the DoS bound on collapse_letter_spacing (bug-ui-scan 2026-06-20 critical): the
letter-spacing repair must stay cheap on adversarial multi-megabyte input — it backs
the public extract/apply path — while still repairing genuine letter-spaced CV text.

Also pins the .txt/.md DECODE contract: those uploads used to be read as UTF-8 with
``errors="ignore"``, which silently deleted every diacritic of a legacy cp1250
("save as ANSI") Czech CV before any downstream pass ever saw it.

AUDIT 2026-08-22 — and the PDF page loop, which had NO coverage here at all even
though PDF is the primary CV upload format and ``_extract_pdf`` lives in this module.
See ``MultiPagePdfTest``.
"""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.extractors as E
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


def _pdf_bytes(page_texts: list[str]) -> bytes:
    """A minimal but structurally valid multi-page PDF (one Helvetica text run per
    page), built in-process so the test needs no committed multi-page fixture.

    The only PDF fixture in the repo is a ONE-page synthetic file, which is exactly
    why the page loop went untested — see MultiPagePdfTest.
    """
    n = len(page_texts)
    font_id = 3 + 2 * n
    page_ids = [3 + 2 * i for i in range(n)]
    content_ids = [4 + 2 * i for i in range(n)]
    objs: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = b" ".join(b"%d 0 R" % pid for pid in page_ids)
    objs.append(b"<< /Type /Pages /Kids [ " + kids + b" ] /Count %d >>" % n)
    for i, text in enumerate(page_texts):
        objs.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (font_id, content_ids[i])
        )
        esc = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("latin-1")
        stream = b"BT /F1 12 Tf 72 720 Td (" + esc + b") Tj ET"
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for idx, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % idx + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objs) + 1,
        xref_at,
    )
    return bytes(out)


class MultiPagePdfTest(unittest.TestCase):
    """The PDF page loop — the primary CV ingestion path, previously untested here.

    MUTATION THAT STAYED GREEN: narrowing ``_extract_pdf``'s bound from
    ``i >= MAX_PDF_PAGES`` to ``i >= 1`` — i.e. throwing away every page of every CV
    after the first — left all 238 tests in this context passing, because the only
    PDF fixture reachable in CI (``samples/profile-fixtures/synthetic-letterspaced.pdf``)
    is a single page. A two-page CV silently loses its entire employment history, and
    the analysis it feeds is a confident, wrong statement about a person.
    """

    _PAGES = [f"PAGEMARKER{i} Employment history entry number {i}." for i in range(5)]

    def _written(self, pages: list[str]) -> str:
        path = Path(tempfile.mkdtemp()) / "cv.pdf"
        path.write_bytes(_pdf_bytes(pages))
        return extract_text(path)

    def test_every_page_reaches_the_extracted_text(self) -> None:
        text = self._written(self._PAGES)
        for i in range(len(self._PAGES)):
            self.assertIn(f"PAGEMARKER{i}", text, f"page {i} was dropped from the extracted CV")
        # …and in document order, so the loop concatenates rather than reshuffles.
        positions = [text.index(f"PAGEMARKER{i}") for i in range(len(self._PAGES))]
        self.assertEqual(positions, sorted(positions), "pages came back out of order")

    def test_page_cap_still_bounds_a_hostile_pdf(self) -> None:
        # Non-vacuity for the test above: the cap is real, it just must not be 1.
        with mock.patch.object(E, "MAX_PDF_PAGES", 2):
            text = self._written(self._PAGES)
        self.assertIn("PAGEMARKER0", text)
        self.assertIn("PAGEMARKER1", text)
        self.assertNotIn("PAGEMARKER2", text)

    def test_cumulative_char_budget_stops_the_loop(self) -> None:
        # The other bound in the same loop: a giant PDF stops on the text budget.
        with mock.patch.object(E, "MAX_TEXT_CHARS", 10):
            text = self._written(self._PAGES)
        self.assertIn("PAGEMARKER0", text)  # never truncates to nothing
        self.assertNotIn("PAGEMARKER4", text)

    def test_letter_spacing_repair_applies_beyond_the_first_page(self) -> None:
        # The repair pass runs over the JOINED page text, so it must reach page 2 —
        # a first-page-only extraction would leave later pages unrepaired.
        text = self._written(["ordinary first page", "K n o w l e d g e base"])
        self.assertIn("Knowledge base", text)


if __name__ == "__main__":
    unittest.main()
