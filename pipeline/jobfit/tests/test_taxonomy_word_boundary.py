"""The free-text skill detector reads whole words plus a BOUNDED inflection tail.

``production`` used to credit the skill ``product``: the compact fallback let a
single-token surface end anywhere inside the word it started. The tail is now
bounded and English derivations that change the concept are refused, while the
Czech feminine forms (``feminine_variants``) and their declensions still match.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.taxonomy import (
    classify_role_family,
    detected_skills,
    feminine_variants,
    normalize_text,
    _is_inflection_tail,
    _text_contains,
    _compact,
)


def _hits(text: str, surface: str) -> bool:
    norm = normalize_text(text)
    return _text_contains(norm, _compact(norm), surface)


class WordBoundaryTests(unittest.TestCase):
    def test_production_does_not_credit_product(self) -> None:
        self.assertFalse(_hits("production systems", "product"))
        self.assertNotIn("product", detected_skills("Worked on production systems"))
        for derived in ("productive", "productivity", "producer"):
            self.assertFalse(_hits(derived, "product"), derived)

    def test_product_and_its_plural_still_match(self) -> None:
        self.assertIn("product", detected_skills("Product manager"))
        self.assertIn("product", detected_skills("shipped several products"))
        self.assertTrue(_hits("products", "product"))

    def test_other_concatenations_no_longer_credit(self) -> None:
        self.assertFalse(_hits("javascript", "java"))
        self.assertFalse(_hits("salesforce", "sales"))

    def test_czech_declension_still_matches(self) -> None:
        self.assertTrue(_hits("programování v pythonu", "python"))
        self.assertTrue(_hits("produktech", "produkt"))
        self.assertTrue(_hits("manažerského", "manažer"))
        self.assertTrue(_hits("vývojářským", "vývoj"))
        self.assertTrue(_is_inflection_tail("ového"))

    def test_every_feminine_example_in_the_comment_block_matches(self) -> None:
        pairs = {
            "analytik": "analytička",
            "grafik": "grafička",
            "logistik": "logistička",
            "biolog": "bioložka",
            "pedagog": "pedagožka",
            "voják": "vojačka",
            "specialista": "specialistka",
            "stážista": "stážistka",
            "právník": "právnička",
            "číšník": "číšnice",
            "prodavač": "prodavačka",
            "zkušený": "zkušená",
            "samostatný": "samostatná",
        }
        for masc, fem in pairs.items():
            if masc.endswith(("ý",)):
                continue  # adjectives are only derived as part of a multi-word phrase
            with self.subTest(masc=masc, fem=fem):
                if feminine_variants(masc):
                    surfaces = (masc, *feminine_variants(masc))
                    self.assertTrue(any(_hits(fem, s) for s in surfaces))
                else:
                    self.assertTrue(_hits(fem, masc))
        self.assertTrue(any(_hits("datová analytička", s) for s in feminine_variants("datový analytik")))
        # the declined feminine reaches the stem too
        self.assertTrue(any(_hits("analytičkou", s) for s in feminine_variants("analytik")))

    def test_gendered_role_pair_still_classifies_alike(self) -> None:
        self.assertEqual(
            classify_role_family([], "vývojář"), classify_role_family([], "vývojářka")
        )


if __name__ == "__main__":
    unittest.main()
