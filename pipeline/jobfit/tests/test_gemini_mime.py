"""The MIME kp declares for an uploaded document comes from its BYTES.

``_mime_type`` was ``mimetypes.guess_type(path.name)`` — the uploader's file
name alone decided what kp told the model a document was. Two problems, one
security-shaped and one correctness-shaped:

  * a file named ``cv.pdf`` was announced as ``application/pdf`` whatever it
    actually contained, so a renamed archive (or anything else) rode into the
    multimodal call with kp vouching for a type it never checked;
  * ``mimetypes`` reads the HOST's mime database — the Windows registry among
    others — so the same upload could be declared differently on two installs,
    and an unknown extension answered whatever that host happened to think.

Now: sniff the magic bytes, answer only from ``ALLOWED_MIME`` (exactly the
formats ``extractors.extract_text`` supports), and answer
``application/octet-stream`` — "bytes we will not vouch for" — for everything
else. This file pins that the NAME cannot move the answer.

Offline: builds tiny real files in a temp dir, no client, no key, no network.
"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from pipeline.jobfit.gemini import (
    ALLOWED_MIME,
    DOCX_MIME,
    FALLBACK_MIME,
    PDF_MIME,
    TEXT_MIME,
    _mime_type,
)


class _Files(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="kp-mime-test-")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def write(self, name: str, data: bytes) -> Path:
        path = self.root / name
        path.write_bytes(data)
        return path

    def docx(self, name: str) -> Path:
        path = self.root / name
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types/>")
            archive.writestr("word/document.xml", "<document/>")
        return path

    def plain_zip(self, name: str) -> Path:
        path = self.root / name
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("notes.txt", "not a word document")
        return path


class SniffingTest(_Files):
    def test_a_pdf_is_recognised_by_its_header(self) -> None:
        self.assertEqual(_mime_type(self.write("a.pdf", b"%PDF-1.7\n1 0 obj\n")), PDF_MIME)

    def test_a_docx_is_recognised_by_opening_the_container(self) -> None:
        self.assertEqual(_mime_type(self.docx("a.docx")), DOCX_MIME)

    def test_plain_text_is_recognised_including_diacritics(self) -> None:
        self.assertEqual(
            _mime_type(self.write("a.txt", "Životopis — Jan Novák".encode("utf-8"))), TEXT_MIME
        )

    def test_markdown_is_declared_as_the_plain_text_it_is(self) -> None:
        self.assertEqual(_mime_type(self.write("a.md", b"# CV\n\n- Python\n")), TEXT_MIME)

    def test_a_utf8_bom_does_not_make_a_text_file_binary(self) -> None:
        self.assertEqual(_mime_type(self.write("a.txt", b"\xef\xbb\xbfhello")), TEXT_MIME)

    def test_a_split_multibyte_character_at_the_window_edge_is_still_text(self) -> None:
        # The sniffer reads a fixed window, so a long CV routinely gets cut
        # mid-character. That must not be read as "binary".
        data = ("á" * 5000).encode("utf-8")
        self.assertEqual(_mime_type(self.write("a.txt", data)), TEXT_MIME)


class RefusalTest(_Files):
    def test_the_file_name_cannot_move_the_answer(self) -> None:
        # The whole point: a ZIP named .pdf is not announced as a PDF.
        self.assertEqual(_mime_type(self.plain_zip("cv.pdf")), FALLBACK_MIME)
        # …and a real PDF named .docx is still a PDF.
        self.assertEqual(_mime_type(self.write("cv.docx", b"%PDF-1.4\n")), PDF_MIME)

    def test_a_zip_that_is_not_a_word_document_is_not_declared_docx(self) -> None:
        self.assertEqual(_mime_type(self.plain_zip("a.docx")), FALLBACK_MIME)

    def test_a_truncated_archive_is_not_declared_docx(self) -> None:
        self.assertEqual(_mime_type(self.write("a.docx", b"PK\x03\x04broken")), FALLBACK_MIME)

    def test_binary_bytes_fall_back_to_octet_stream(self) -> None:
        self.assertEqual(_mime_type(self.write("a.bin", b"\x89PNG\r\n\x1a\n\x00\x00")), FALLBACK_MIME)

    def test_an_empty_file_is_not_vouched_for(self) -> None:
        self.assertEqual(_mime_type(self.write("a.txt", b"")), FALLBACK_MIME)

    def test_an_unreadable_path_is_not_vouched_for(self) -> None:
        self.assertEqual(_mime_type(self.root / "does-not-exist.pdf"), FALLBACK_MIME)


class AllowListTest(_Files):
    def test_every_answer_is_on_the_allow_list_or_the_fallback(self) -> None:
        cases = [
            self.write("a.pdf", b"%PDF-1.7\n"),
            self.docx("a.docx"),
            self.write("a.txt", b"plain"),
            self.plain_zip("b.zip"),
            self.write("a.bin", b"\x00\x01\x02"),
            self.write("a.weirdext", b"%PDF-1.7\n"),
        ]
        for path in cases:
            with self.subTest(name=path.name):
                self.assertIn(_mime_type(path), (*ALLOWED_MIME, FALLBACK_MIME))

    def test_the_allow_list_covers_exactly_the_supported_formats(self) -> None:
        # extractors.extract_text accepts PDF, DOCX, TXT and MD — and nothing
        # else. The declared set must not be wider than what we can read.
        self.assertEqual(set(ALLOWED_MIME), {PDF_MIME, DOCX_MIME, TEXT_MIME})


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
