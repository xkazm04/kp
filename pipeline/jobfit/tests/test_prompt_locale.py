from __future__ import annotations

import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.gemini as G
from pipeline.jobfit.i18n import DEFAULT_LANG, LANG_NAMES, language_directive, normalize_lang

# The app ships four locales; the frontend literal array is the single source of
# truth (i18n/locales.ts, mirroring the WORKSPACE_TAB_IDS pattern). Parsed rather
# than hard-coded so adding a 5th locale to the product immediately demands a
# Python name for it instead of silently collapsing that locale to English.
_ROOT = Path(__file__).resolve().parents[3]
_LOCALES_TS = _ROOT / "i18n" / "locales.ts"


def _shipped_locales() -> list[str]:
    text = _LOCALES_TS.read_text(encoding="utf-8")
    m = re.search(r"export const LOCALES\s*=\s*\[([^\]]*)\]", text)
    assert m, f"LOCALES literal not found in {_LOCALES_TS}"
    return re.findall(r'"([a-z]{2})"', m.group(1))


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

    def test_every_shipped_locale_reaches_the_prompt_as_ITSELF(self) -> None:
        """AUDIT 2026-08-22 — the gap this file used to have.

        The two tests above check only ``cs`` and ``en``. Narrowing
        ``i18n.normalize_lang`` to ``primary in ("en", "cs")`` — i.e. making the
        two locales the product also ships, ``de`` and ``fr``, silently collapse
        to English at EVERY prompt site — left this file (and all 20 guards in
        this context) green. That is the exact shape of "a German recruiter was
        handed a pack in the wrong language".

        So: every locale in i18n/locales.ts must reach the prompt naming its OWN
        language, and must not smuggle any other shipped language's directive in
        alongside it.
        """
        shipped = _shipped_locales()
        self.assertGreaterEqual(len(shipped), 4, "expected at least en/cs/de/fr in locales.ts")
        for locale in shipped:
            with self.subTest(locale=locale):
                self.assertIn(
                    locale,
                    LANG_NAMES,
                    f"locale {locale!r} ships in the app but has no Python language name — "
                    "every prompt site would silently write English for it",
                )
                expected = LANG_NAMES[locale]
                prompt = self._capture_prompt(locale)
                self.assertIn(
                    f"in {expected}",
                    prompt,
                    f"the {locale!r} analyze prompt never asks for {expected} narrative",
                )
                for other, other_name in LANG_NAMES.items():
                    if other == locale:
                        continue
                    self.assertNotIn(
                        f"MUST be written in {other_name}",
                        prompt,
                        f"the {locale!r} prompt also demands {other_name} narrative",
                    )

    def test_bcp47_tags_and_junk_normalize_predictably(self) -> None:
        # A locale arrives from a cookie / ?lang / Accept-Language as a full tag.
        # It must resolve to its own language, not fall through to the default.
        for locale in _shipped_locales():
            with self.subTest(locale=locale):
                for tag in (locale, locale.upper(), f"{locale}-{locale.upper()}"):
                    self.assertEqual(normalize_lang(tag), locale, tag)
        # ...while genuinely unsupported input still fails safe to the default.
        for junk in ("zz", "", None, 42, "klingon"):
            self.assertEqual(normalize_lang(junk), DEFAULT_LANG, repr(junk))

    def test_shared_language_directive_names_every_shipped_language(self) -> None:
        # The directive is the one string every OTHER prompt site (automation
        # interview_prep / rejection / offer, campaign, intake, group_compare,
        # agentfit) embeds, so a locale missing here is wrong app-wide, not just
        # in the analyze prompt this class captures.
        for locale in _shipped_locales():
            with self.subTest(locale=locale):
                directive = language_directive(locale)
                self.assertIn(f"in {LANG_NAMES[locale]}", directive)
                self.assertIn("never translate or localize those", directive)

    def test_enum_values_are_kept_verbatim_regardless_of_locale(self) -> None:
        prompt = self._capture_prompt("cs")
        self.assertIn("DO NOT translate", prompt)
        self.assertIn("current_seniority", prompt)


class BlindModeFailsClosedTest(unittest.TestCase):
    """Blind screening must never fall back to uploading the ORIGINAL file when the
    redacted text is empty (an encrypted/scanned/unsupported PDF) — that would send
    name/contact/photo to the model while the audit claims 'identity redacted'."""

    def _run(self, blind_text: str) -> dict:
        called: dict = {"grounded": False, "parts": None}

        def fake_grounded(**kwargs: object) -> G.GroundedAnswer:
            called["grounded"] = True
            called["parts"] = kwargs.get("parts")
            return G.GroundedAnswer(text="{}", payload={"profile": {"raw_text": "x"}})

        fd, name = tempfile.mkstemp(suffix=".txt")
        os.write(fd, b"Some CV text")
        os.close(fd)
        tmp = Path(name)
        try:
            with mock.patch.object(G, "grounded_answer", fake_grounded):
                G.analyze_profile_with_gemini(tmp, blind_text=blind_text)
        finally:
            tmp.unlink()
        return called

    def test_empty_redacted_text_fails_closed_without_uploading_the_file(self) -> None:
        # The raise happens before the file is ever read/uploaded.
        with self.assertRaises(RuntimeError):
            self._run("")
        with self.assertRaises(RuntimeError):
            self._run("   \n  ")  # whitespace-only is equally empty

    def test_blind_with_text_sends_no_file_bytes(self) -> None:
        called = self._run("Redacted CV text for [NAME].")
        self.assertTrue(called["grounded"])
        self.assertEqual(called["parts"], [])  # text-only; the original file is NOT uploaded


if __name__ == "__main__":
    unittest.main()
