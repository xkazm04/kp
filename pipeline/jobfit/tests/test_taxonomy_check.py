"""The taxonomy authoring harness must CATCH planted defects.

These feed :func:`lint_taxonomy` synthetic bad terms and assert each defect is
reported. If the lint stops catching one of these, a real authoring mistake in
``data/taxonomy.json`` would slip through silently — which is exactly the
instrumentation gap the harness exists to close.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy_check as tc

_FAMILIES = frozenset({"software_engineering", "finance_accounting"})
_SIGNALS = frozenset({"english", "leadership"})


def _lint(terms, **kw):
    tax = {"terms": terms, "salary_signals": {k: {} for k in _SIGNALS}}
    kw.setdefault("families", _FAMILIES)
    return tc.lint_taxonomy(tax, **kw)


def _good_term(tid="alpha", **over):
    term = {
        "id": tid,
        "match": [tid, f"{tid}-cs"],
        "categories": ["skill"],
        "role_family_votes": {"software_engineering": 1},
    }
    term.update(over)
    return term


class LintCatchesDefectsTest(unittest.TestCase):
    def test_baseline_good_terms_pass(self) -> None:
        res = _lint([_good_term("alpha"), _good_term("beta")])
        self.assertTrue(res.ok, res.errors)
        self.assertEqual(res.warnings, [])

    def test_dangling_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["ghost"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("dangling parent" in e and "ghost" in e for e in res.errors), res.errors)

    def test_duplicate_id_is_caught(self) -> None:
        res = _lint([_good_term("dup"), _good_term("dup")])
        self.assertFalse(res.ok)
        self.assertTrue(any("duplicate term id" in e for e in res.errors), res.errors)

    def test_vote_to_unknown_family_is_caught(self) -> None:
        res = _lint([_good_term("alpha", role_family_votes={"made_up_family": 1})])
        self.assertFalse(res.ok)
        self.assertTrue(any("unknown family" in e and "made_up_family" in e for e in res.errors), res.errors)

    def test_single_surface_form_is_flagged(self) -> None:
        # Monolingual term: a WARNING (many legitimate proper nouns are monolingual),
        # but it must be surfaced so bilingual coverage stays measurable.
        res = _lint([_good_term("alpha", match=["alpha"])])
        self.assertTrue(res.ok, res.errors)  # not an error
        self.assertTrue(any("single surface form" in w for w in res.warnings), res.warnings)

    def test_empty_match_is_caught(self) -> None:
        res = _lint([_good_term("alpha", match=[])])
        self.assertFalse(res.ok)
        self.assertTrue(any("'match' must be a non-empty list" in e for e in res.errors), res.errors)

    def test_unknown_category_is_caught(self) -> None:
        res = _lint([_good_term("alpha", categories=["skill", "not_a_category"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("unknown category" in e for e in res.errors), res.errors)

    def test_bad_salary_signal_is_caught(self) -> None:
        res = _lint([_good_term("alpha", salary_signal="nonexistent_signal")])
        self.assertFalse(res.ok)
        self.assertTrue(any("salary_signal" in e and "nonexistent_signal" in e for e in res.errors), res.errors)

    def test_within_term_duplicate_surface_is_caught(self) -> None:
        # Two forms that normalize to the same value (case/diacritic fold).
        res = _lint([_good_term("alpha", match=["Java", "java"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("duplicate normalized value" in e for e in res.errors), res.errors)

    def test_self_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["alpha"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("its own parent" in e for e in res.errors), res.errors)


def _tax(terms):
    return {"terms": terms}


class CorpusCollisionScanTest(unittest.TestCase):
    """The compact-fallback collision scan must catch the classes the 3-char
    abbreviations are dense with, and must NOT cry wolf on legit matches."""

    def test_stem_in_system_is_caught(self) -> None:
        # The named planted-trap class: a short single-token surface whose compact
        # form sits INTERIOR to an unrelated corpus word ("stem" inside "system").
        corpus = tc.build_corpus(["We run a payment system for millions of clients."])
        terms = [_good_term("stem_field", match=["stem", "stem obory"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertTrue(coll, "expected a collision for 'stem' inside 'system'")
        c = coll[0]
        self.assertEqual((c.term_id, c.kind), ("stem_field", "interior"))
        self.assertIn("system", c.context)

    def test_cross_word_collision_is_caught(self) -> None:
        # A short single-token surface whose characters are drawn from two
        # concatenated corpus words ("sox" <- "espresso xcuitest").
        corpus = tc.build_corpus(["Tested with espresso xcuitest on device."])
        terms = [_good_term("sarbanes_oxley", match=["sox", "sox compliance"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        kinds = {(c.surface, c.kind) for c in coll}
        self.assertIn(("sox", "cross_word"), kinds)

    def test_dpo_interior_in_czech_is_caught(self) -> None:
        # The real hazard from the direction: bare "dpo" hits inside Czech words.
        corpus = tc.build_corpus(["Musíš odpovídat za ochranu údajů."])
        terms = [_good_term("dpo_role", match=["dpo", "data protection officer"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertTrue(any(c.surface == "dpo" and c.kind == "interior" for c in coll), coll)

    def test_multiword_phrase_is_not_a_collision(self) -> None:
        # A multi-word surface legitimately spans word boundaries in the compacted
        # blob — that phrase match is the whole point of the compact fallback, so it
        # must NEVER be reported as a cross-word collision.
        corpus = tc.build_corpus(["We perform customer due diligence on every client."])
        terms = [_good_term("cdd", match=["customer due diligence", "hloubková kontrola"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertEqual(coll, [], f"multi-word phrase wrongly flagged: {coll}")

    def test_prefix_inflection_is_exempt(self) -> None:
        # Czech inflection appends a suffix, so the corpus word STARTS with the
        # surface ("audit" -> "auditor"/"auditu"). The compact fallback fires there
        # too, but it is the same concept, not an unrelated word — not a collision.
        corpus = tc.build_corpus(["Senior auditor vede interní audit a auditu se věnuje."])
        terms = [_good_term("audit", match=["audit", "interní audit"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertEqual(coll, [], f"prefix inflection wrongly flagged: {coll}")

    def test_short_form_below_three_chars_is_skipped(self) -> None:
        # The live matcher's compact fallback only fires for len>=3; a 2-char form
        # ("hr") is matched whole-token only and must not be scanned for collisions.
        corpus = tc.build_corpus(["The chráněný workshop hires staff."])
        terms = [_good_term("human_resources", match=["hr", "human resources"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertEqual([c for c in coll if c.surface == "hr"], [])


class LiveNonTechCollisionGateTest(unittest.TestCase):
    """The legal_compliance + hr_people vocabulary was authored THROUGH the scan:
    every surface these two families introduce must be collision-clean against the
    representative seeded corpus (jobs + candidates, incl. the non-tech slice)."""

    def test_new_nontech_families_are_collision_clean(self) -> None:
        taxonomy = tc.load_taxonomy()
        corpus = tc.seed_corpus()
        # Terms that vote ONLY the two new families (i.e. surfaces authored here, not
        # grandfathered finance/tech terms merely cross-voted in).
        new_ids = {
            t["id"]
            for t in taxonomy["terms"]
            if set((t.get("role_family_votes") or {}))
            and set((t.get("role_family_votes") or {})) <= {"legal_compliance", "hr_people"}
        }
        self.assertGreater(len(new_ids), 60, "expected the authored legal+HR vocabulary")
        coll = tc.scan_corpus_collisions(taxonomy, corpus, term_ids=new_ids, categories=None)
        self.assertEqual(
            coll, [],
            "authored legal/HR surfaces collide with the seed corpus:\n  "
            + "\n  ".join(c.describe() for c in coll),
        )

    def test_seed_corpus_is_non_empty(self) -> None:
        # The gate above is only meaningful against a real corpus.
        corpus = tc.seed_corpus()
        self.assertGreater(len(corpus.word_compacts), 500)
        self.assertGreater(len(corpus.blobs), 100)


if __name__ == "__main__":
    unittest.main()
