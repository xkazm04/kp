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


class _Reports(unittest.TestCase):
    """Mixin: assert a lint report NAMES a defect, and print the report when it does not.

    Every assertion below used to be `assertTrue(any(frag in e for e in res.errors))`.
    That is a truth value: the failure said "False is not true", and the diagnostic —
    which errors the lint DID report, the thing you need to fix it — arrived only
    because each call site remembered to pass `res.errors` as the message. These two
    helpers make that structural, and `assertIn` reports the haystack itself.
    """

    def assertReportsError(self, res, *fragments: str) -> None:
        matching = [e for e in res.errors if all(f in e for f in fragments)]
        self.assertNotEqual(
            matching, [], f"no error mentions all of {list(fragments)}; got: {res.errors}"
        )

    def assertReportsWarning(self, res, *fragments: str) -> None:
        matching = [w for w in res.warnings if all(f in w for f in fragments)]
        self.assertNotEqual(
            matching, [], f"no warning mentions all of {list(fragments)}; got: {res.warnings}"
        )


def _good_term(tid="alpha", **over):
    term = {
        "id": tid,
        "match": [tid, f"{tid}-cs"],
        "categories": ["skill"],
        "role_family_votes": {"software_engineering": 1},
    }
    term.update(over)
    return term


class LintCatchesDefectsTest(_Reports):
    def test_baseline_good_terms_pass(self) -> None:
        res = _lint([_good_term("alpha"), _good_term("beta")])
        self.assertEqual((res.ok, res.errors), (True, []))
        self.assertEqual(res.warnings, [])

    def test_dangling_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["ghost"])])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "dangling parent", "ghost")

    def test_duplicate_id_is_caught(self) -> None:
        res = _lint([_good_term("dup"), _good_term("dup")])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "duplicate term id")

    def test_vote_to_unknown_family_is_caught(self) -> None:
        res = _lint([_good_term("alpha", role_family_votes={"made_up_family": 1})])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "unknown family", "made_up_family")

    def test_single_surface_form_is_flagged(self) -> None:
        # Monolingual term: a WARNING (many legitimate proper nouns are monolingual),
        # but it must be surfaced so bilingual coverage stays measurable.
        res = _lint([_good_term("alpha", match=["alpha"])])
        self.assertEqual((res.ok, res.errors), (True, []))  # not an error
        self.assertReportsWarning(res, "single surface form")

    def test_empty_match_is_caught(self) -> None:
        res = _lint([_good_term("alpha", match=[])])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "'match' must be a non-empty list")

    def test_unknown_category_is_caught(self) -> None:
        res = _lint([_good_term("alpha", categories=["skill", "not_a_category"])])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "unknown category")

    def test_bad_salary_signal_is_caught(self) -> None:
        res = _lint([_good_term("alpha", salary_signal="nonexistent_signal")])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "salary_signal", "nonexistent_signal")

    def test_within_term_duplicate_surface_is_caught(self) -> None:
        # Two forms that normalize to the same value (case/diacritic fold).
        res = _lint([_good_term("alpha", match=["Java", "java"])])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "duplicate normalized value")

    def test_self_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["alpha"])])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "its own parent")

    def test_bilingual_exempt_suppresses_single_form_warning(self) -> None:
        # A proper-noun term declares itself monolingual-by-nature; no bilingual warning.
        res = _lint([_good_term("kubernetes", match=["kubernetes"], bilingual_exempt=True)])
        self.assertEqual((res.ok, res.errors), (True, []))
        self.assertEqual(res.warnings, [])

    def test_bilingual_exempt_on_multiform_term_is_caught(self) -> None:
        # The flag is only for genuinely monolingual terms; a >=2-form exempt term is
        # a contradiction (someone gaming the parity number) and must error.
        res = _lint([_good_term("alpha", match=["alpha", "alfa"], bilingual_exempt=True)])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "bilingual_exempt", "surface forms")

    def test_bilingual_exempt_must_be_boolean(self) -> None:
        res = _lint([_good_term("alpha", match=["alpha"], bilingual_exempt="yes")])
        self.assertFalse(res.ok)
        self.assertReportsError(res, "bilingual_exempt must be a boolean")


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
        self.assertNotEqual(coll, [], "expected a collision for 'stem' inside 'system'")
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
        self.assertIn(("dpo", "interior"), [(c.surface, c.kind) for c in coll])

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


# Non-tech families whose SKILL vocabulary was authored THROUGH the collision scan.
# Phase 2 seeded legal_compliance + hr_people; phase 3 (care/trades/frontline) added
# the four biggest unmodelled verticals; phase 4 (last-families) closes the final
# three — creative_design, life_sciences_research, general_professional — so the
# vocabulary is 16/16. Every SKILL surface these families introduce must be
# collision-clean against the representative seeded corpus.
_AUTHORED_NONTECH_FAMILIES: frozenset[str] = frozenset(
    {
        "legal_compliance",
        "hr_people",
        "healthcare_clinical",
        "skilled_trades",
        "frontline_service",
        "education_academic",
        "creative_design",
        "life_sciences_research",
        "general_professional",
    }
)


class LiveNonTechCollisionGateTest(unittest.TestCase):
    """The authored non-tech SKILL vocabulary was written THROUGH the scan: every
    surface these families introduce must be collision-clean against the
    representative seeded corpus (jobs + candidates, incl. the non-tech slice).

    Scoped to the ``skill`` category on purpose — that is the vocabulary these
    directions author. Grandfathered ``role_title`` terms (e.g. the bare "waiter"
    surface on ``role_food_service``) predate the scan and are out of scope; the
    skill graph never resolves through them."""

    def test_new_nontech_families_are_collision_clean(self) -> None:
        taxonomy = tc.load_taxonomy()
        corpus = tc.seed_corpus()
        # Skill terms that vote ONLY the authored non-tech families (i.e. surfaces
        # authored here, not grandfathered finance/tech terms merely cross-voted in,
        # nor role_title classifier terms).
        new_ids = {
            t["id"]
            for t in taxonomy["terms"]
            if "skill" in (t.get("categories") or [])
            and set((t.get("role_family_votes") or {}))
            and set((t.get("role_family_votes") or {})) <= _AUTHORED_NONTECH_FAMILIES
        }
        self.assertGreater(len(new_ids), 200, "expected the authored non-tech skill vocabulary")
        coll = tc.scan_corpus_collisions(taxonomy, corpus, term_ids=new_ids, categories=None)
        self.assertEqual(
            coll, [],
            "authored non-tech skill surfaces collide with the seed corpus:\n  "
            + "\n  ".join(c.describe() for c in coll),
        )

    def test_seed_corpus_is_non_empty(self) -> None:
        # The gate above is only meaningful against a real corpus.
        corpus = tc.seed_corpus()
        self.assertGreater(len(corpus.word_compacts), 500)
        self.assertGreater(len(corpus.blobs), 100)
        self.assertEqual(len(corpus.texts), len(corpus.blobs))


class LiveCollisionGateTest(unittest.TestCase):
    """The corpus-collision report is no longer INFORMATIONAL: any collision that is
    LIVE under the current matcher and not explicitly blessed fails the build.

    The static scan (above) answers "could this surface substring-hit the corpus";
    the gate answers the consequential question "does ``_text_contains`` actually
    award it". The word-grid guard neutralizes the interior/cross-word classes, so
    the only live hits left are the three verified-benign separator spellings.
    """

    def test_every_live_collision_is_on_the_allow_list(self) -> None:
        taxonomy = tc.load_taxonomy()
        corpus = tc.seed_corpus()
        gated = tc.gate_collisions(tc.scan_corpus_collisions(taxonomy, corpus), corpus)
        self.assertEqual(
            gated, [],
            "live false-credit collision(s) — fix the surface or bless it in "
            "BENIGN_COMPACT_SURFACES:\n  " + "\n  ".join(c.describe() for c in gated),
        )

    def test_allow_list_is_not_a_blanket(self) -> None:
        # Non-vacuity: the allow-list is three named surfaces, not "everything that
        # currently collides" — the 10 neutralized ones are fixed, not excused.
        self.assertEqual(
            tc.BENIGN_COMPACT_SURFACES,
            frozenset({"node.js", "ci/cd", "cross-selling"}),
        )

    def test_gate_fails_on_a_live_false_credit_surface(self) -> None:
        # Non-vacuity of the GATE itself. The word-grid guard kills interior and
        # ragged cross-word hits, but an EXACT word-boundary span survives by
        # design (it is how "nodejs" matches "Node.js") — and that same mechanism
        # lets "iam" be read out of the prose "I am …". Not allow-listed -> gated.
        corpus = tc.build_corpus(["I am responsible for access reviews."])
        terms = [_good_term("iam", match=["iam", "identity and access management"])]
        coll = tc.scan_corpus_collisions(_tax(terms), corpus, categories=None)
        self.assertIn("iam", [c.surface for c in coll])
        gated = tc.gate_collisions(coll, corpus)
        self.assertIn("iam", [c.surface for c in gated])

    def test_prefix_inflection_hit_is_not_gated(self) -> None:
        # A hazard reported against word A ("pyspark") must not be judged LIVE by an
        # unrelated benign inflection hit on word B ("ve sparku") — that was a real
        # false positive while building this gate.
        corpus = tc.build_corpus(["Vývoj transformací ve sparku nad pyspark joby."])
        c = tc.Collision("spark", "spark", "spark", "interior", "pyspark")
        self.assertFalse(tc.collision_is_live(c, corpus))

    def test_cli_exits_clean(self) -> None:
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = tc.main([])
        self.assertEqual(rc, 0, buf.getvalue())


if __name__ == "__main__":
    unittest.main()
