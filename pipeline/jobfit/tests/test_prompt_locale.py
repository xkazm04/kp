from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.gemini as G


class AnalyzePromptLocaleTest(unittest.TestCase):
    """The analyze prompt must request narrative in the chosen language while
    keeping the CV's original language and the canonical enum/code values intact.
    We patch the model call and inspect the prompt that would have been sent."""

    def _capture_prompt(self, lang: str) -> str:
        captured: dict[str, str] = {}

        def fake_grounded(**kwargs: object) -> G.GroundedAnswer:
            captured["prompt"] = str(kwargs.get("prompt", ""))
            # A minimally valid payload so analyze_profile_with_gemini returns.
            return G.GroundedAnswer(text="{}", payload={"profile": {"raw_text": "x"}})

        fd, name = tempfile.mkstemp(suffix=".txt")
        os.write(fd, b"Some CV text")
        os.close(fd)
        tmp = Path(name)
        try:
            with mock.patch.object(G, "grounded_answer", fake_grounded):
                G.analyze_profile_with_gemini(tmp, lang=lang)
        finally:
            tmp.unlink()
        return captured["prompt"]

    def test_czech_locale_requests_czech_narrative(self) -> None:
        prompt = self._capture_prompt("cs")
        self.assertIn("in Czech", prompt)
        # The retired forced-English instruction must be gone.
        self.assertNotIn("MUST be written in English", prompt)

    def test_default_locale_requests_english_narrative(self) -> None:
        prompt = self._capture_prompt("en")
        self.assertIn("in English", prompt)

    def test_enum_values_are_kept_verbatim_regardless_of_locale(self) -> None:
        prompt = self._capture_prompt("cs")
        self.assertIn("DO NOT translate", prompt)
        self.assertIn("current_seniority", prompt)


if __name__ == "__main__":
    unittest.main()
