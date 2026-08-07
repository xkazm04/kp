"""The 25 MB input cap must be enforced on the Gemini UPLOAD path, before the
file is read into memory / shipped to the API.

extract_text's `_reject_oversized` runs in the pipeline pre-pass, but
`_extract_pre_pass` DEGRADES that ValueError to a note and lets the analysis
continue — so without an independent guard a 200 MB "CV" reached
`path.read_bytes()` inside `analyze_profile_with_gemini` and was uploaded whole,
blowing the documented limit (bug-ui-scan 2026-07-09 #5). Both file-reading
Gemini entry points now `_reject_oversized(path)` before `read_bytes()`.

Offline: `grounded_answer` is spied so the model is never actually called; the
size gate must fire first.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.extractors as E
import pipeline.jobfit.gemini as G


class GeminiOversizeGuardTest(unittest.TestCase):
    def _oversized_file(self, tmp: str) -> Path:
        # A tiny real file that counts as "oversized" once the cap is patched down,
        # so the test needs no multi-MB fixture.
        path = Path(tmp) / "huge.pdf"
        path.write_bytes(b"x" * 50)
        return path

    def _spy_grounded(self, called: dict):
        def spy(**_kwargs):
            called["grounded"] = True
            raise AssertionError("must NOT upload an oversized file to Gemini")

        return spy

    def test_analyze_rejects_oversized_before_upload(self) -> None:
        called: dict = {}
        with tempfile.TemporaryDirectory() as tmp:
            path = self._oversized_file(tmp)
            with mock.patch.object(E, "MAX_INPUT_BYTES", 10), mock.patch.object(
                G, "grounded_answer", self._spy_grounded(called)
            ):
                # Non-blind (blind_text=None) → the file bytes would be uploaded.
                with self.assertRaises(ValueError) as cm:
                    G.analyze_profile_with_gemini(path, job_description_text="jd")
        # Pre-fix: no guard → grounded_answer (the spy) was reached and raised
        # AssertionError instead, and `grounded` flipped True.
        self.assertIn("too large", str(cm.exception))
        self.assertNotIn("grounded", called)

    def test_extract_text_rejects_oversized_before_upload(self) -> None:
        called: dict = {}
        with tempfile.TemporaryDirectory() as tmp:
            path = self._oversized_file(tmp)
            with mock.patch.object(E, "MAX_INPUT_BYTES", 10), mock.patch.object(
                G, "grounded_answer", self._spy_grounded(called)
            ):
                with self.assertRaises(ValueError) as cm:
                    G.extract_profile_text_with_gemini(path)
        self.assertIn("too large", str(cm.exception))
        self.assertNotIn("grounded", called)

    def test_within_limit_file_is_not_rejected(self) -> None:
        # Pins the gate is size-conditional, not an unconditional refusal: a normal
        # file passes the guard and reaches grounded_answer (here the spy).
        called: dict = {}
        with tempfile.TemporaryDirectory() as tmp:
            path = self._oversized_file(tmp)
            with mock.patch.object(G, "grounded_answer", self._spy_grounded(called)):
                # Real MAX_INPUT_BYTES (25 MB) >> 50 bytes → guard passes, spy fires.
                with self.assertRaises(AssertionError):
                    G.extract_profile_text_with_gemini(path)
        self.assertTrue(called["grounded"])


if __name__ == "__main__":
    unittest.main()
