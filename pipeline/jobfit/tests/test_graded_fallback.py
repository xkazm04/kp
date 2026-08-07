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
            "řízení frobnitz", "řízení wibblewob", "frobnitz direction",
            "wibble identity design", "wibble strategy design", "quokka graphics",
            "florptool",
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

    def test_one_side_fallback_shares_the_same_ceiling(self) -> None:
        # The one-side fallback occupies the SAME band as the neither-side token
        # fallback: below sibling(0.4), above nothing(0.0). So the full ordering
        # exact > specialization > generalization > sibling > one-side/token-fallback
        # (≤0.3) > 0 holds with both fallback flavors on the same rung.
        sibling = term_match_score("seo", "ppc")                          # 0.4
        one_side = skill_match_score("data science", "data scientist", STRONG)  # ≤0.3
        token = unresolved_pair_score("langgraph agent", "agent langgraph")    # ≤0.3
        nothing = skill_match_score("python", "quokka runtime", STRONG)        # 0.0
        self.assertGreater(sibling, one_side)
        self.assertLessEqual(one_side, _FALLBACK_CAP)
        self.assertLessEqual(token, _FALLBACK_CAP)
        self.assertGreater(one_side, nothing)
        self.assertEqual(nothing, 0.0)


class ResolvedPairRegressionTest(unittest.TestCase):
    """BOTH-resolve behavior is unchanged (the fallback must not leak into a pair the
    hierarchy already scores); the ONE-side case now earns bounded, sub-threshold
    credit instead of a false hard zero (one-side-resolves honesty)."""

    def test_both_resolve_unrelated_stays_zero(self) -> None:
        # react and python both resolve; no hierarchy edge -> 0.0, as before. If the
        # fallback leaked, their shared-nothing tokens would still be 0.0 anyway, so
        # this also proves no token credit sneaks into a resolved pair.
        self.assertEqual(skill_match_score("react", "python", STRONG), 0.0)

    def test_both_resolve_exact_is_full(self) -> None:
        self.assertEqual(skill_match_score("python", "python", STRONG), 1.0)

    def test_exactly_one_resolves_earns_capped_subthreshold_credit(self) -> None:
        # "python" resolves, "python framework thing" does not. They share the
        # distinctive token "python", so the one-side fallback now scores the
        # unresolved surface against python's alias set — bounded ≤_FALLBACK_CAP,
        # symmetric, and strictly below the match threshold. NO longer a false 0.0.
        for a, b in (("python", "python framework thing"), ("python framework thing", "python")):
            s = skill_match_score(a, b, STRONG)
            self.assertGreater(s, 0.0, (a, b))
            self.assertLessEqual(s, _FALLBACK_CAP, (a, b))
            from pipeline.jobfit.matching import _MATCH_THRESHOLD
            self.assertLess(s, _MATCH_THRESHOLD, (a, b))

    def test_one_side_no_shared_token_stays_zero(self) -> None:
        # "python" resolves, "quokka runtime" does not, and they share no distinctive
        # token -> a true 0.0. The one-side fallback only rescues a genuine overlap.
        self.assertEqual(skill_match_score("python", "quokka runtime", STRONG), 0.0)

    def test_one_side_fallback_never_reaches_matched(self) -> None:
        # Even maximal one-side overlap is capped below sibling/threshold: the credit
        # is adjacency, never a "matched" claim.
        self.assertLessEqual(skill_match_score("python", "python python", STRONG), _FALLBACK_CAP)

    def test_hierarchy_partials_unchanged(self) -> None:
        self.assertAlmostEqual(skill_match_score("swiftui", "swift", STRONG), 0.9)
        self.assertAlmostEqual(skill_match_score("seo", "ppc", STRONG), 0.4)


class OneSideFalseZeroTest(unittest.TestCase):
    """The false-zero class the one-side fallback closes: a MODELLED term vs its own
    UNMODELLED surface variant. "data scientist" resolves (data_scientist); "data
    science" does not — before, the pair scored a hard 0.0 despite the shared "data"
    head. Now it earns capped, sub-threshold adjacency credit, classified honestly."""

    def test_modelled_term_vs_unmodelled_variant_is_graded_adjacency(self) -> None:
        self.assertIsNotNone(tax.resolve_term("data scientist"))
        self.assertIsNone(tax.resolve_term("data science"))
        s = skill_match_score("data science", "data scientist", STRONG)
        self.assertGreater(s, 0.0)
        self.assertLessEqual(s, _FALLBACK_CAP)

    def test_score_skills_classifies_it_unproven_adjacency(self) -> None:
        # provenance_default is explicit here (and on the fixtures below): the shipped
        # default is now `self_declared`, which applies an evidence discount. These
        # tests are about how the graded TOKEN FALLBACK is classified (matched /
        # unproven-adjacency / missing), not about that discount, so they pin the
        # professional tier — otherwise the reason flips to "both" for an unrelated
        # reason and the fallback's own behaviour is no longer what is under test.
        cand = MatchCandidate(
            skills=["data science"],
            seniority="senior", role_family="data_ai",
            languages=["English"], years_experience=6,
            provenance_default="professional",
        )
        job = mkjob(
            role_family="data_ai",
            requirements=[
                {"skill": "data scientist", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        score, matched, missing, _strength, unproven = score_skills(cand, job)
        # NOT matched, NOT missing — it lives in the honest middle bucket, tagged
        # adjacency (a related, non-exact skill), and it lifted the sub-score off 0.
        self.assertNotIn("data scientist", matched)
        self.assertNotIn("data scientist", missing)
        self.assertIn("data scientist", unproven)
        self.assertEqual(unproven["data scientist"]["reason"], "adjacency")
        self.assertGreater(unproven["data scientist"]["score"], 0.0)
        self.assertLessEqual(unproven["data scientist"]["score"], _FALLBACK_CAP)
        self.assertGreater(score, 0.0)


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
    """The graded token-fallback yields a three-state skill verdict — matched /
    unproven(adjacency) / missing — for skills the taxonomy does NOT model, where
    before every pair was a bare 0/1 and the middle state could not exist. Uses
    invented surfaces so it exercises the fallback path regardless of how much real
    vocabulary the taxonomy grows (phase 4 modelled the creative surfaces this
    fixture originally used)."""

    def _candidate(self) -> MatchCandidate:
        return MatchCandidate(
            skills=["frobnitz direction", "wibble identity design", "florptool"],
            seniority="senior",
            role_family="creative_design",
            languages=["English"],
            years_experience=8,
            provenance_default="professional",
        )

    def _job(self):
        return mkjob(
            role_family="creative_design",
            requirements=[
                {"skill": "frobnitz direction", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "wibble strategy design", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "quokka graphics", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )

    def test_bucket_is_three_state(self) -> None:
        score, matched, missing, strength, unproven = score_skills(self._candidate(), self._job())

        # matched: an exact (un-modelled) string match still earns full credit.
        self.assertIn("frobnitz direction", matched)
        self.assertEqual(strength["frobnitz direction"], 1.0)

        # unproven: a token-overlap partial ("wibble ... design") is sub-threshold and
        # honestly classified "adjacency" (a fractional signal exists), NOT missing.
        self.assertIn("wibble strategy design", unproven)
        self.assertNotIn("wibble strategy design", matched)
        self.assertNotIn("wibble strategy design", missing)
        self.assertEqual(unproven["wibble strategy design"]["reason"], "adjacency")
        self.assertLessEqual(unproven["wibble strategy design"]["score"], _FALLBACK_CAP)
        self.assertGreater(unproven["wibble strategy design"]["score"], 0.0)

        # missing: no distinctive token in common -> a true gap.
        self.assertIn("quokka graphics", missing)

        # The three buckets are disjoint and the sub-score is positive.
        self.assertGreater(score, 0.0)

    def test_weak_provenance_flips_reason_to_both(self) -> None:
        # The same adjacency partial, but self-declared -> "both" (related AND weak).
        cand = MatchCandidate(
            skills=["frobnitz direction", "wibble identity design", "florptool"],
            seniority="senior",
            role_family="creative_design",
            languages=["English"],
            years_experience=8,
            provenance_default="professional",
            skill_provenance={"wibble identity design": WEAK},
        )
        _s, _m, _mi, _st, unproven = score_skills(cand, self._job())
        self.assertEqual(unproven["wibble strategy design"]["reason"], "both")


if __name__ == "__main__":
    unittest.main()
