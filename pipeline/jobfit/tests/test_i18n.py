from __future__ import annotations

import unittest

from pipeline.jobfit.i18n import (
    DEFAULT_LANG,
    language_directive,
    language_name,
    normalize_lang,
)


class NormalizeLangTest(unittest.TestCase):
    def test_known_codes_pass_through(self) -> None:
        self.assertEqual(normalize_lang("en"), "en")
        self.assertEqual(normalize_lang("cs"), "cs")

    def test_bcp47_tag_matches_primary_subtag(self) -> None:
        self.assertEqual(normalize_lang("cs-CZ"), "cs")
        self.assertEqual(normalize_lang("EN-US"), "en")
        self.assertEqual(normalize_lang("  CS  "), "cs")

    def test_app_locales_pass_through(self) -> None:
        # LANG_NAMES mirrors the app LOCALES (en/cs/de/fr); de/fr resolve to
        # themselves now that the app ships them, rather than collapsing to English.
        self.assertEqual(normalize_lang("de"), "de")
        self.assertEqual(normalize_lang("fr-FR"), "fr")

    def test_unknown_or_nonstring_falls_back_to_default(self) -> None:
        self.assertEqual(normalize_lang("xx"), DEFAULT_LANG)
        self.assertEqual(normalize_lang(""), DEFAULT_LANG)
        self.assertEqual(normalize_lang(None), DEFAULT_LANG)
        self.assertEqual(normalize_lang(123), DEFAULT_LANG)


class LanguageNameTest(unittest.TestCase):
    def test_maps_code_to_english_name(self) -> None:
        self.assertEqual(language_name("cs"), "Czech")
        self.assertEqual(language_name("en"), "English")
        self.assertEqual(language_name("cs-CZ"), "Czech")
        # Unknown defaults to the English language name.
        self.assertEqual(language_name("xx"), "English")


class LanguageDirectiveTest(unittest.TestCase):
    def test_names_the_target_language(self) -> None:
        self.assertIn("Czech", language_directive("cs"))

    def test_preserves_code_values_verbatim(self) -> None:
        directive = language_directive("cs")
        self.assertIn("verbatim", directive)
        self.assertIn("advance|hold|reject", directive)
        self.assertIn("never translate", directive.lower())

    def test_default_directive_is_english(self) -> None:
        self.assertIn("English", language_directive("en"))
        self.assertIn("English", language_directive("bogus"))


if __name__ == "__main__":
    unittest.main()
