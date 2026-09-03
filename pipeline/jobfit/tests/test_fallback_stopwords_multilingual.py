"""The graded fallback's stopword discipline holds in all four shipped languages.

``unresolved_pair_score`` gives bounded, sub-threshold credit to a skill pair the
taxonomy cannot resolve, but only when the two surfaces share a DISTINCTIVE token. The
head-token rule is what refuses the classic false positive — "management of X" vs
"management of Y" share nothing but glue, so they score 0.0 rather than looking related.

That rule is only as wide as ``_FALLBACK_STOPWORDS``, and the list covered English and
Czech while ``i18n.LANG_NAMES`` has shipped en/cs/de/fr for some time. So a German ad's
"Entwicklung von X" vs "Entwicklung von Y" and a French "Gestion de X" vs "Gestion de Y"
shared a head token on pure glue and scored — in exactly the two languages the rule was
never extended to. One test per language, each in the language's own script.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.i18n import LANG_NAMES
from pipeline.jobfit.taxonomy import (
    _FALLBACK_CAP,
    _FALLBACK_STOPWORDS,
    _fallback_tokens,
    unresolved_pair_score,
)

# One pair per language: same glue and same generic role noun, DIFFERENT subject. A
# human reads these as two unrelated skills, so the engine must score them 0.0.
GLUE_ONLY_PAIRS: dict[str, tuple[str, str]] = {
    "en": ("management of databases", "management of suppliers"),
    # CS shares the glue only: the Czech GENERIC ROLE FILLER ("vedení", "správa",
    # "podpora") is still absent from the list, the same asymmetry de/fr had for the
    # glue itself — recorded, not silently widened here.
    "cs": ("školení v angličtině", "podpora v němčině"),
    "de": ("Entwicklung von Datenbanken", "Entwicklung von Netzwerken"),
    "fr": ("Gestion de projets", "Gestion de risques"),
}

# The same pairs made GENUINELY related by a shared distinctive token, so the tests
# above cannot pass by the fallback being dead everywhere.
SHARED_HEAD_PAIRS: dict[str, tuple[str, str]] = {
    "en": ("management of databases", "administration of databases"),
    "cs": ("školení v angličtině", "školení v matematice"),
    "de": ("Entwicklung von Datenbanken", "Betrieb von Datenbanken"),
    "fr": ("Gestion de projets", "Pilotage de projets"),
}


class GlueOnlyEarnsNothingTest(unittest.TestCase):
    def test_every_shipped_language_has_a_pair_under_test(self) -> None:
        # A locale added to LANG_NAMES without a stopword pass is exactly the gap de/fr
        # sat in; this is the line that reddens when the fifth language arrives.
        self.assertEqual(set(GLUE_ONLY_PAIRS), set(LANG_NAMES))
        self.assertEqual(set(SHARED_HEAD_PAIRS), set(LANG_NAMES))

    def test_a_glue_only_overlap_scores_nothing(self) -> None:
        for lang, (a, b) in GLUE_ONLY_PAIRS.items():
            with self.subTest(lang=lang):
                self.assertEqual(
                    unresolved_pair_score(a, b),
                    0.0,
                    f"[{lang}] {a!r} vs {b!r} share only glue and generic role filler",
                )

    def test_the_distinctive_token_sets_are_disjoint(self) -> None:
        # The mechanism, not just the number: what survives the filter must differ.
        for lang, (a, b) in GLUE_ONLY_PAIRS.items():
            with self.subTest(lang=lang):
                ta, tb = _fallback_tokens(a), _fallback_tokens(b)
                self.assertTrue(ta and tb, f"[{lang}] a surface filtered to nothing at all")
                self.assertEqual(ta & tb, frozenset(), f"[{lang}] {sorted(ta & tb)} survived as a head")

    def test_a_genuine_shared_head_still_earns_bounded_credit(self) -> None:
        # NON-VACUITY: if the stopword list swallowed everything, the test above would
        # pass for the wrong reason. A real shared subject must still score, and still
        # stay under the cap so it can never classify as "matched".
        for lang, (a, b) in SHARED_HEAD_PAIRS.items():
            with self.subTest(lang=lang):
                score = unresolved_pair_score(a, b)
                self.assertGreater(score, 0.0, f"[{lang}] a real shared subject earned nothing")
                self.assertLessEqual(score, _FALLBACK_CAP, f"[{lang}] fallback exceeded its cap")

    def test_an_exact_surface_match_is_untouched_by_the_wider_list(self) -> None:
        # The exact-string branch runs before tokenization, so a wholly generic but
        # IDENTICAL surface keeps its legacy 1.0 in every language.
        for lang, (a, _) in GLUE_ONLY_PAIRS.items():
            with self.subTest(lang=lang):
                self.assertEqual(unresolved_pair_score(a, a), 1.0)


class StopwordListHygieneTest(unittest.TestCase):
    def test_the_list_is_normalized_the_way_surfaces_are(self) -> None:
        # Entries are compared against normalize_text output (NFC + casefold, NO
        # diacritic folding), so an upper-case or NFD entry would simply never match.
        import unicodedata

        for word in _FALLBACK_STOPWORDS:
            self.assertEqual(word, word.casefold(), f"{word!r} is not casefolded")
            self.assertEqual(word, unicodedata.normalize("NFC", word), f"{word!r} is not NFC")

    def test_no_entry_is_shorter_than_the_min_token_length(self) -> None:
        # Sub-3-char entries are dead weight: _fallback_tokens drops those tokens on
        # length before the stopword test ever sees them. The EN/CS entries predate the
        # length filter and are kept (harmless, and they document the intent), so this
        # only pins that the NEW de/fr rows did not add more of them.
        from pipeline.jobfit.taxonomy import _FALLBACK_MIN_TOKEN_LEN

        short = {w for w in _FALLBACK_STOPWORDS if len(w) < _FALLBACK_MIN_TOKEN_LEN}
        self.assertTrue(
            short <= {"of", "or", "a", "an", "to", "in", "on", "at", "by", "as",
                      "v", "ve", "na", "se", "si", "o", "z", "ze", "do", "po", "k", "u", "i", "s"},
            f"new sub-{_FALLBACK_MIN_TOKEN_LEN}-char entries that can never fire: {sorted(short)}",
        )

    def test_acronyms_that_collide_with_glue_are_deliberately_absent(self) -> None:
        # A stopword can only ever REMOVE credit, and removing it from a genuine
        # acronym pair is the one way this list does harm. These French/German glue
        # words are real technology acronyms and are left out on purpose.
        # ("des" and "ces" ARE listed — a DES/CES pair is identical on both sides and
        # takes unresolved_pair_score's exact-match branch before tokenization, so the
        # stopword can never reach it.)
        for acronym in ("est", "sur", "par", "son", "sap", "sas", "rest"):
            self.assertNotIn(acronym, _FALLBACK_STOPWORDS, f"{acronym!r} collides with an acronym")


if __name__ == "__main__":
    unittest.main()
