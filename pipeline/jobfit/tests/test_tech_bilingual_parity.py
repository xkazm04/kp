"""Direction 2: tech-bilingual-parity — Czech tech surfaces now RESOLVE.

The pilot hires developers with Czech-language JDs, yet the tech families were the
LEAST bilingual: software_engineering 57%, data_ai 38% by raw >=2-surface count.
Concept/abbreviation terms (ai, nlp, analytics, "řízení projektu") carried only a
single surface, so a Czech requirement fell through ``resolve_term`` to raw string
equality and missed its own term. This proves the added Czech (+English-expansion)
aliases now resolve, that proper-noun terms count as bilingual-by-nature, and that
NO English resolution changed (no ranking drift on English corpora).
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax
from pipeline.jobfit import taxonomy_check as tc
from pipeline.jobfit.matching import MatchCandidate, score_personal, score_skills
from pipeline.jobfit.tests._helpers import mkjob


class CzechTechSurfacesResolveTest(unittest.TestCase):
    def test_czech_concept_surfaces_now_resolve(self) -> None:
        # Each of these was a single-surface term before Direction 2, so the Czech
        # (or English-expansion) form did not resolve and fell to string equality.
        self.assertEqual(tax.resolve_term("umělá inteligence"), "ai")
        self.assertEqual(tax.resolve_term("artificial intelligence"), "ai")
        self.assertEqual(tax.resolve_term("zpracování přirozeného jazyka"), "nlp")
        self.assertEqual(tax.resolve_term("datová analytika"), "analytics")
        self.assertEqual(tax.resolve_term("projektové řízení"), "rizeni_projektu")
        self.assertEqual(tax.resolve_term("project management"), "rizeni_projektu")
        self.assertEqual(tax.resolve_term("řízení zainteresovaných stran"), "stakeholder")

    def test_czech_jd_requirement_now_earns_full_credit(self) -> None:
        # Czech-language JD + CV. Before D2, "umělá inteligence" and "artificial
        # intelligence" both resolved to None, so skill_match_score fell to string
        # equality across the two different strings -> 0.0 (a false miss). Now both
        # resolve to `ai` -> exact match, 1.0.
        # provenance_default is explicit: the shipped default is now `self_declared`,
        # which discounts the match. This test is about the Czech surface RESOLVING
        # to the same taxonomy term (taxonomy credit), not about the evidence
        # discount, so it pins the professional tier.
        cand = MatchCandidate(
            skills=["umělá inteligence", "zpracování přirozeného jazyka"],
            seniority="senior", role_family="data_ai",
            languages=["Czech", "English"], years_experience=6,
            provenance_default="professional",
        )
        job = mkjob(
            role_family="data_ai",
            requirements=[
                {"skill": "artificial intelligence", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "nlp", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 1.0)
        self.assertIn("artificial intelligence", matched)
        self.assertIn("nlp", matched)
        self.assertEqual(missing, [])
        self.assertEqual(strength["artificial intelligence"], 1.0)

    def test_string_equality_baseline_would_have_missed(self) -> None:
        # Pin the mechanism: the Czech surface and the English requirement are
        # DIFFERENT strings, so the pre-taxonomy string-equality fallback scores 0.
        from pipeline.jobfit.taxonomy import normalize_text as N
        self.assertNotEqual(N("umělá inteligence").strip(), N("artificial intelligence").strip())
        # ...yet both resolve to the same term now, which is what rescues the match.
        self.assertEqual(tax.resolve_term("umělá inteligence"), tax.resolve_term("artificial intelligence"))


class EnglishResolutionUnchangedTest(unittest.TestCase):
    """No ranking change for English corpora: every pre-existing English surface must
    still resolve to exactly the same term (the new aliases never hijack one)."""

    def test_proper_nouns_and_existing_surfaces_unchanged(self) -> None:
        cases = {
            "python": "python",
            "react": "react",
            "kubernetes": "kubernetes",
            "machine learning": "machine_learning",
            "strojové učení": "machine_learning",
            "ml": "machine_learning",                  # merged: "ML" IS machine_learning
            "data scientist": "data_scientist",       # NOT `scientist` (kept separate)
            "datový vědec": "data_scientist",
            "docker": "docker",
            "tableau": "tableau",
        }
        for surface, expected in cases.items():
            self.assertEqual(tax.resolve_term(surface), expected, surface)

    def test_hierarchy_scores_unchanged(self) -> None:
        # A representative slice of the English skill graph, unchanged by D2.
        self.assertAlmostEqual(tax.term_match_score("swiftui", "swift"), 0.9)
        self.assertAlmostEqual(tax.term_match_score("swift", "swiftui"), 0.55)
        self.assertEqual(tax.term_match_score("react", "python"), 0.0)


class OverlapHeuristicBilingualParityTest(unittest.TestCase):
    """Parity is not only about ``resolve_term``: ``score_personal``'s description
    -overlap term must treat a Czech pair exactly as it treats the English one.

    It did not. ``matching._WORD_RE`` was ASCII (``[a-z0-9]+``), so every diacritic
    read as a word SEPARATOR and an accented skill was shredded into one- and
    two-letter fragments — fragments Czech prose is full of. Measured on the pair
    below, the Czech nurse scored HIGHER on an iOS ad than her English twin scored
    on the identical English ad: false personal-fit credit handed out by language,
    which is precisely the parity claim this file exists to make.

    The assertion is a CROSS-LANGUAGE EQUALITY rather than an absolute number, so it
    stays true under any future re-calibration of the overlap term while still
    failing the moment the two languages diverge.
    """

    AD_CZ = (
        "Náš tým staví iOS aplikace. Nabízíme podíl na produktu, "
        "kávu zdarma a čistý kód v Swiftu."
    )
    AD_EN = (
        "Our team builds iOS apps. We offer a share in the product, "
        "free coffee and clean code in Swift."
    )

    def _cand(self, skill: str) -> MatchCandidate:
        return MatchCandidate(
            skills=[skill], seniority="senior", role_family="healthcare_clinical",
            languages=["Czech", "English"], years_experience=6,
            provenance_default="professional",
        )

    def _job(self, description: str):
        # languages=[] so the language term is the NEUTRAL constant and the overlap
        # term is the only thing that can separate the two sides.
        return mkjob(description=description, languages=[], requirements=[])

    def test_an_off_domain_skill_scores_the_same_in_czech_as_in_english(self) -> None:
        cz = score_personal(self._cand("podávání léků"), self._job(self.AD_CZ))
        en = score_personal(self._cand("administering medication"), self._job(self.AD_EN))
        self.assertEqual(
            cz, en,
            "a Czech clinical skill earned description-overlap credit on an iOS ad "
            "that its English twin did not — the accented surface was shredded into "
            "letter fragments instead of tokenized as whole words",
        )

    def test_an_on_domain_skill_also_scores_the_same_in_both_languages(self) -> None:
        # The other direction: parity must not be bought by under-crediting Czech.
        cz = score_personal(self._cand("čistý kód"), self._job(self.AD_CZ))
        en = score_personal(self._cand("clean code"), self._job(self.AD_EN))
        self.assertEqual(cz, en)
        # Non-vacuity: the on-domain skill really does out-score the off-domain one,
        # so the equality above is not two identical zeros.
        self.assertGreater(cz, score_personal(self._cand("podávání léků"), self._job(self.AD_CZ)))


class BilingualParityMetricTest(unittest.TestCase):
    """The parity metric counts proper-noun exemptions but only where the flag is set,
    and the three pilot tech families reach ~100% parity."""

    def setUp(self) -> None:
        self.taxonomy = tc.load_taxonomy()
        self.rows = {r.family: r for r in tc.coverage_by_family(self.taxonomy)}

    def test_tech_families_reach_full_parity(self) -> None:
        for fam in ("software_engineering", "data_ai", "product_project"):
            self.assertAlmostEqual(self.rows[fam].pct_parity, 100.0, msg=fam)

    def test_parity_is_bilingual_plus_exempt(self) -> None:
        r = self.rows["software_engineering"]
        self.assertEqual(r.bilingual_parity, r.bilingual + r.bilingual_exempt)
        self.assertGreater(r.bilingual_exempt, 0, "swe parity relies on proper-noun exemptions")

    def test_the_parity_formula_is_pinned_off_the_live_data(self) -> None:
        # EVERY live family is at 100% parity today, so `bilingual_parity ==
        # bilingual + exempt` is arithmetically indistinguishable from
        # `== total_terms` on the shipped taxonomy — the assertion above cannot
        # actually constrain the formula. Pin it on a row where the three numbers
        # genuinely differ, so "counts exemptions, and ONLY exemptions" is a real
        # claim: a single-surface term WITHOUT the flag must never reach parity.
        row = tc.FamilyCoverage(
            family="synthetic", skill_terms=4, total_terms=10, with_parents=3,
            bilingual=4, bilingual_exempt=2,
        )
        self.assertEqual(row.bilingual_parity, 6)      # NOT 10
        self.assertAlmostEqual(row.pct_parity, 60.0)   # NOT 100.0
        self.assertAlmostEqual(row.pct_bilingual, 40.0)
        self.assertAlmostEqual(row.pct_parents, 30.0)

    def test_an_unflagged_single_surface_term_is_counted_as_a_gap(self) -> None:
        # Same claim end-to-end through the counter: three terms voting for one
        # family — bilingual, exempt-monolingual, and monolingual-with-NO-flag. Only
        # the first two may reach parity; the third is the gap the metric exists to
        # show. (The flag is explicit per-term, so parity can never be gamed by
        # silently exempting a term that does have a Czech surface.)
        synthetic = {
            "terms": [
                {"id": "a", "match": ["project management", "projektové řízení"],
                 "categories": ["skill"], "role_family_votes": {"synthetic_fam": 1}},
                {"id": "b", "match": ["docker"], "bilingual_exempt": True,
                 "categories": ["skill"], "role_family_votes": {"synthetic_fam": 1}},
                {"id": "c", "match": ["stakeholder alignment"],
                 "categories": ["skill"], "role_family_votes": {"synthetic_fam": 1}},
            ]
        }
        row = {r.family: r for r in tc.coverage_by_family(synthetic)}["synthetic_fam"]
        self.assertEqual((row.total_terms, row.bilingual, row.bilingual_exempt), (3, 1, 1))
        self.assertEqual(row.bilingual_parity, 2)
        self.assertAlmostEqual(row.pct_parity, 100.0 * 2 / 3)

    def test_new_tech_aliases_are_collision_clean(self) -> None:
        # The Czech/expansion aliases added to the concept terms must not spuriously
        # hit the seed corpus via the compact fallback.
        alias_ids = {
            "ai", "llm", "nlp", "analytics", "scientist", "model",
            "product", "delivery", "stakeholder", "manager", "rizeni_projektu",
        }
        coll = tc.scan_corpus_collisions(
            self.taxonomy, tc.seed_corpus(), term_ids=alias_ids, categories=None
        )
        self.assertEqual(coll, [], "\n  ".join(c.describe() for c in coll))

    def test_exempt_terms_are_genuinely_monolingual(self) -> None:
        # Guard against gaming: an exempt term must actually carry a single surface
        # form (the lint enforces this too; assert it live on the shipped data).
        from pipeline.jobfit.taxonomy import normalize_text as N
        for t in self.taxonomy["terms"]:
            if t.get("bilingual_exempt"):
                forms = {N(m).strip() for m in t["match"] if isinstance(m, str) and m.strip()}
                self.assertLess(len(forms), 2, f"{t['id']} is exempt but has {len(forms)} forms")


if __name__ == "__main__":
    unittest.main()
