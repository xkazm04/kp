"""The text extractor's two failure branches, and the envelope they answer with.

``pipeline.jobfit.extract_cli`` backs /api/extract-text — the endpoint the analyze form
and the (public, keyless) conversational apply both call before anything else happens.
It had no test, and it printed its own ``{error, status}`` envelope with NO ``code``, so
"that's a .rtf, attach a PDF" (the user fixes it in one click) and a broken PDF parser
(retry or escalate) reached the browser as the same anonymous failure.

Two branches, two meanings:
  * a ValueError from the extractor (unsupported suffix, oversized, undecodable)
    -> 400 / invalid_input, exit 2
  * anything else                                          -> 500 / engine_error, exit 1
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import _cli, extract_cli


def _run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = extract_cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _last_json(stream: str) -> dict:
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


class ExtractCliErrorBranchesTest(unittest.TestCase):
    def test_an_unsupported_file_type_is_the_callers_mistake(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "resume.rtf"
            path.write_text("not a supported document", encoding="utf-8")
            rc, out, err = _run([str(path)])
        env = _last_json(err)
        self.assertEqual((env["status"], env["code"]), (400, "invalid_input"))
        self.assertIn("Unsupported file type", env["error"])
        self.assertEqual(rc, 2)
        self.assertEqual(out.strip(), "", "a failure prints nothing on stdout")

    def test_an_extractor_fault_is_an_engine_error(self) -> None:
        with mock.patch.object(extract_cli, "extract_text", side_effect=RuntimeError("pypdf exploded")):
            rc, _out, err = _run(["cv.pdf"])
        env = _last_json(err)
        self.assertEqual((env["status"], env["code"]), (500, "engine_error"))
        self.assertEqual(env["error"], "pypdf exploded")
        self.assertEqual(rc, 1)

    def test_both_branches_speak_the_shared_vocabulary(self) -> None:
        # Non-vacuity: a word outside _cli.ERROR_CODES resolves to no errors.<CODE>
        # catalog key and would be rendered as raw English in every locale.
        for exc in (ValueError("Unsupported file type: .rtf"), OSError("disk gone")):
            with mock.patch.object(extract_cli, "extract_text", side_effect=exc):
                _rc, _out, err = _run(["cv.pdf"])
            self.assertIn(_last_json(err)["code"], _cli.ERROR_CODES)

    def test_the_envelope_is_one_line_of_unescaped_utf8(self) -> None:
        # parseStderrError reads the LAST line of stderr, and a \\uXXXX-escaped Czech
        # message would reach the reader mangled.
        with mock.patch.object(extract_cli, "extract_text", side_effect=ValueError("nečitelný dokument")):
            _rc, _out, err = _run(["cv.pdf"])
        self.assertEqual(len([ln for ln in err.splitlines() if ln.strip()]), 1)
        self.assertIn("nečitelný", err)

    def test_the_happy_path_still_prints_one_json_object(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "notes.txt"
            path.write_text("Senior Python engineer, Brno.", encoding="utf-8")
            rc, out, err = _run([str(path)])
        self.assertEqual(rc, 0)
        self.assertEqual(err.strip(), "")
        self.assertIn("Senior Python engineer", json.loads(out)["text"])


if __name__ == "__main__":
    unittest.main()
