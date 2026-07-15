"""Direction: graded-fallback-scoring — a deterministic, bounded token-overlap
partial for skill pairs the taxonomy cannot resolve (BOTH surfaces absent from
``_SURFACE_TO_TERM``).

Before this, such a pair collapsed to normalized string equality (1.0 or 0.0,
nothing between) — the exact situation for un-modelled vocabulary (creative,
life-sciences, general-professional families still at zero terms; any brand-new
tech term). The fallback feeds the EXISTING additive machinery a fractional,
sub-threshold, "adjacency"-grade score, never a ``matched`` claim.

Covered here:
  * the pure ``unresolved_pair_score`` (Jaccard over distinctive token sets, head
    token required, capped ≤0.3);
  * the pinned TOTAL ORDERING exact > specialization > generalization > sibling >
    token-fallback > nothing;
  * ZERO change for any pair the taxonomy already resolves (regression);
  * hazards — short tokens, stopword-only overlap, negation/substring traps, Czech
    diacritics normalization;
  * a creative_design fixture where the unproven bucket becomes three-state.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax
from pipeline.jobfit.taxonomy import (
    _FALLBACK_CAP,
    skill_match_score,
    term_match_score,
    unresolved_pair_score,
)
from pipeline.jobfit.matching import MatchCandidate, score_skills
from pipeline.jobfit.tests._helpers import mkjob

STRONG = "professional"  # provenance_weight 1.0 (no discount)
WEAK = "self_declared"   # provenance_weight 0.4


class UnresolvedPreconditionTest(unittest.TestCase):
    """Every surface these tests lean on must genuinely be OUTSIDE the taxonomy,
    or they'd exercise the hierarchy path instead of the fallback."""

    def test_fixture_surfaces_are_unresolved(self) -> None:
        for surface in (
            "quokka framework", "quokka runtime", "langgraph agent", "agent langgraph",
            "management of frobnitz", "management of wibblewob", "frobscript",
            "frobjavascript", "relational frobnitz", "non-relational frobnitz",
            "řízení frobnitz", "řízení wibblewob", "art direction",
            "brand identity design", "brand strategy design", "motion graphics",
            "typography",
        ):
            self.assertIsNone(tax.resolve_term(surface), f"{surface!r} unexpectedly resolves")


class PureFunctionTest(unittest.TestCase):
    def test_exact_string_match_is_full_credit(self) -> None:
        # An un-modelled term matches itself: the legacy 1.0 outcome, preserved.
        self.assertEqual(unresolved_pair_score("langgraph", "langgraph"), 1.0)

    def test_partial_overlap_is_graded_and_capped(self) -> None:
        # "quokka framework" vs "quokka runtime": share {quokka} of {quokka,
        # framework, runtime} -> jaccard 1/3 -> 0.3 * 1/3 = 0.1.
        s = unresolved_pair_score("quokka framework", "quokka runtime")
        self.assertAlmostEqual(s, 0.1)
        self.assertGreater(s, 0.0)
        self.assertLessEqual(s, _FALLBACK_CAP)

    def test_full_token_overlap_hits_the_cap_not_one(self) -> None:
        # Same distinctive tokens, different order -> jaccard 1.0 -> exactly the cap,
        # NEVER 1.0 (that is reserved for a literal string match).
        s = unresolved_pair_score("langgraph agent", "agent langgraph")
        self.assertAlmostEqual(s, _FALLBACK_CAP)
        self.assertLess(s, 1.0)

    def test_no_shared_distinctive_token_is_zero(self) -> None:
        self.assertEqual(unresolved_pair_score("quokka framework", "wibble runtime"), 0.0)

    def test_empty_or_missing_is_zero(self) -> None:
        self.assertEqual(unresolved_pair_score("", "quokka"), 0.0)
        self.assertEqual(unresolved_pair_score(None, "quokka"), 0.0)
        self.assertEqual(unresolved_pair_score("quokka", None), 0.0)


class TotalOrderingTest(unittest.TestCase):
    """The pinned ordering the whole design rests on:
    exact(1.0) > specialization(0.9) > generalization(0.55) > sibling(0.4) >
    token-fallback(≤0.3) > nothing(0.0)."""

    def test_hierarchy_and_fallback_are_strictly_ordered(self) -> None:
        exact = term_match_score("python", "python")            # 1.0
        specialization = term_match_score("swiftui", "swift")   # 0.9
        generalization = term_match_score("swift", "swiftui")   # 0.55
        sibling = term_match_score("seo", "ppc")                # 0.4
        fallback = unresolved_pair_score("langgraph agent", "agent langgraph")  # cap 0.3
        nothing = unresolved_pair_score("quokka framework", "wibble runtime")   # 0.0

        self.assertEqual(exact, 1.0)
        self.assertAlmostEqual(specialization, 0.9)
        self.assertAlmostEqual(generalization, 0.55)
        self.assertAlmostEqual(sibling, 0.4)
        self.assertLessEqual(fallback, _FALLBACK_CAP)
        self.assertEqual(nothing, 0.0)

        ordered = [exact, specialization, generalization, sibling, fallback, nothing]
        self.assertEqual(ordered, sorted(ordered, reverse=True))
        for hi, lo in zip(ordered, ordered[1:]):
            self.assertGreater(hi, lo)

    def test_fallback_cap_is_below_sibling_and_threshold(self) -> None:
        from pipeline.jobfit.matching import _MATCH_THRESHOLD
        self.assertLess(_FALLBACK_CAP, tax._SIBLING_MATCH)
        self.assertLess(_FALLBACK_CAP, _MATCH_THRESHOLD)


class ResolvedPairRegressionTest(unittest.TestCase):
    """ZERO change when either side resolves — the fallback must not leak."""

    def test_both_resolve_unrelated_stays_zero(self) -> None:
        # react and python both resolve; no hierarchy edge -> 0.0, as before. If the
        # fallback leaked, their shared-nothing tokens would still be 0.0 anyway, so
        # this also proves no token credit sneaks into a resolved pair.
        self.assertEqual(skill_match_score("react", "python", STRONG), 0.0)

    def test_both_resolve_exact_is_full(self) -> None:
        self.assertEqual(skill_match_score("python", "python", STRONG), 1.0)

    def test_exactly_one_resolves_gets_no_fallback_credit(self) -> None:
        # "python" resolves, "python framework thing" does not. Even though they share
        # the distinctive token "python", the taxonomy already has an opinion on the
        # modelled side, so the pair keeps its legacy string-equality outcome: 0.0.
        self.assertEqual(skill_match_score("python", "python framework thing", STRONG), 0.0)
        self.assertEqual(skill_match_score("python framework thing", "python", STRONG), 0.0)

    def test_hierarchy_partials_unchanged(self) -> None:
        self.assertAlmostEqual(skill_match_score("swiftui", "swift", STRONG), 0.9)
        self.assertAlmostEqual(skill_match_score("seo", "ppc", STRONG), 0.4)


class HazardTest(unittest.TestCase):
    def test_short_tokens_do_not_spuriously_match(self) -> None:
        # "c" and "c++" both reduce to the 1-char token {c}, dropped by the min-length
        # filter, so the distinctive sets are empty -> 0.0, NOT a spurious 1.0.
        self.assertEqual(unresolved_pair_score("c", "c++"), 0.0)
        self.assertEqual(unresolved_pair_score("go", "golang"), 0.0)  # go dropped (len 2)

    def test_stopword_only_overlap_scores_nothing(self) -> None:
        # "management of X" vs "management of Y", X≠Y: the only shared tokens are the
        # generic glue "management"/"of", both filtered, so the distinctive sets are
        # disjoint -> 0.0. The distinctive tail carries the meaning and it differs.
        self.assertEqual(
            unresolved_pair_score("management of frobnitz", "management of wibblewob"),
            0.0,
        )

    def test_substring_is_never_a_match(self) -> None:
        # "frobscript" is a substring of "frobjavascript" but a DIFFERENT whole token,
        # so it earns no credit — whole-token discipline, never substring.
        self.assertEqual(unresolved_pair_score("frobscript", "frobjavascript"), 0.0)

    def test_negation_stays_bounded_and_sub_threshold(self) -> None:
        # "relational frobnitz" vs "non-relational frobnitz": the negation keeps its
        # own "non" token in the union, dragging the score DOWN (2/3 -> 0.2) rather
        # than matching. Bounded, sub-threshold, never "matched".
        s = unresolved_pair_score("relational frobnitz", "non-relational frobnitz")
        self.assertAlmostEqual(s, 0.2)
        self.assertLessEqual(s, _FALLBACK_CAP)

    def test_czech_diacritics_normalize_consistently(self) -> None:
        # Same casefold+NFC normalizer as the rest of the module: an upper/diacritic
        # variant folds to the same tokens -> an exact match.
        self.assertEqual(unresolved_pair_score("Řízení Frobnitz", "řízení frobnitz"), 1.0)
        # A partial where only the diacritic head token is shared: proves "řízení"
        # folds identically on both sides (else there'd be no overlap).
        s = unresolved_pair_score("řízení frobnitz", "řízení wibblewob")
        self.assertAlmostEqual(s, 0.1)
        self.assertGreater(s, 0.0)


class ThreeStateUnprovenFixtureTest(unittest.TestCase):
    """A creative_design family (still at ZERO taxonomy terms) now yields a
    three-state skill verdict — matched / unproven(adjacency) / missing — where
    before every pair was a bare 0/1 and the middle state could not exist."""

    def _candidate(self) -> MatchCandidate:
        return MatchCandidate(
            skills=["art direction", "brand identity design", "typography"],
            seniority="senior",
            role_family="creative_design",
            languages=["English"],
            years_experience=8,
        )

    def _job(self):
        return mkjob(
            role_family="creative_design",
            requirements=[
                {"skill": "art direction", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "brand strategy design", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "motion graphics", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )

    def test_bucket_is_three_state(self) -> None:
        score, matched, missing, strength, unproven = score_skills(self._candidate(), self._job())

        # matched: an exact (un-modelled) string match still earns full credit.
        self.assertIn("art direction", matched)
        self.assertEqual(strength["art direction"], 1.0)

        # unproven: a token-overlap partial ("brand ... design") is sub-threshold and
        # honestly classified "adjacency" (a fractional signal exists), NOT missing.
        self.assertIn("brand strategy design", unproven)
        self.assertNotIn("brand strategy design", matched)
        self.assertNotIn("brand strategy design", missing)
        self.assertEqual(unproven["brand strategy design"]["reason"], "adjacency")
        self.assertLessEqual(unproven["brand strategy design"]["score"], _FALLBACK_CAP)
        self.assertGreater(unproven["brand strategy design"]["score"], 0.0)

        # missing: no distinctive token in common -> a true gap.
        self.assertIn("motion graphics", missing)

        # The three buckets are disjoint and the sub-score is positive.
        self.assertGreater(score, 0.0)

    def test_weak_provenance_flips_reason_to_both(self) -> None:
        # The same adjacency partial, but self-declared -> "both" (related AND weak).
        cand = MatchCandidate(
            skills=["art direction", "brand identity design", "typography"],
            seniority="senior",
            role_family="creative_design",
            languages=["English"],
            years_experience=8,
            skill_provenance={"brand identity design": WEAK},
        )
        _s, _m, _mi, _st, unproven = score_skills(cand, self._job())
        self.assertEqual(unproven["brand strategy design"]["reason"], "both")


if __name__ == "__main__":
    unittest.main()
