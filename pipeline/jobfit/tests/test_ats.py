"""Locks in the keyword-coverage panel as a genuinely INDEPENDENT ATS check.

The live pipeline used to hand ``evaluate_keyword_coverage`` a dead third
argument — ``build_profile(clean_text(jd)).skills`` OR the LLM's own
``matching + missing`` lists. The regex builder always returns ``skills=[]``
(see :func:`pipeline.jobfit.profiling.build_profile`), so the left operand was
permanently empty and the ``or`` fell through to the LLM's lists. Coverage then
only ever re-checked skills the LLM had already labelled — a tautology that
could never surface a JD keyword the LLM (or the candidate) missed, while
reading a misleadingly high ``coverage_percent``.

These tests pin the fixed contract: when no authoritative ``job_skills`` list is
supplied, the JD keyword universe is harvested from the JD text itself, so a JD
keyword absent from both the CV and the LLM's lists is surfaced as an unmatched
hit. They also pin the root cause and the still-honored authoritative path.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.ats import (
    KEYWORD_STUFFING_JD_RATIO,
    KEYWORD_STUFFING_MIN_CV_OCCURRENCES,
    MAX_KEYWORD_HITS,
    MAX_MISSING_KEYWORDS,
    _keyword_status,
    _normalize,
    _occurrences,
    _skill_in_text,
    evaluate_keyword_coverage,
    verify_skills_in_cv,
)
from pipeline.jobfit import taxonomy
from pipeline.jobfit.extractors import clean_text
from pipeline.jobfit.profiling import build_profile

# A JD that demands Kubernetes; a CV that only proves Python. The LLM labelled
# only Python as matching and surfaced no missing skills — so Kubernetes lives
# entirely outside the LLM's lists and can only be caught by harvesting the JD.
_JD = "Senior platform engineer. Must have hands-on Kubernetes and Python in production."
_CV = "I have shipped backend services in Python for five years."
_MATCHING = ["Python"]
_MISSING: list[str] = []


def _hit_for(coverage, keyword: str):
    keyword = keyword.lower()
    for hit in coverage.hits:
        if hit.keyword.lower() == keyword:
            return hit
    return None


class IndependentHarvestTest(unittest.TestCase):
    def test_root_cause_build_profile_skills_is_always_empty(self) -> None:
        # The dead operand: the regex builder never extracts skills, so the old
        # left side of the `or` could never contribute JD keywords.
        self.assertEqual(build_profile(clean_text(_JD)).skills, [])

    def test_harvest_surfaces_jd_keyword_the_llm_missed(self) -> None:
        # No job_skills passed -> harvest the JD's own keywords. Kubernetes is in
        # the JD, absent from the CV, and absent from both LLM lists, yet it must
        # still appear as an unmatched hit.
        coverage = evaluate_keyword_coverage(
            _CV, _JD, matching_skills=_MATCHING, missing_skills=_MISSING
        )
        kube = _hit_for(coverage, "kubernetes")
        self.assertIsNotNone(kube, "JD keyword 'Kubernetes' was not harvested")
        self.assertFalse(kube.matched)
        # A genuinely missed requirement must drag coverage below 100%.
        self.assertLess(coverage.coverage_percent, 100)
        # The keyword the candidate DOES prove still counts as covered.
        python = _hit_for(coverage, "python")
        self.assertIsNotNone(python)
        self.assertTrue(python.matched)

    def test_old_tautology_wiring_would_hide_the_gap(self) -> None:
        # Reproduces the dead path: feeding the LLM's own matching+missing lists
        # as job_skills suppresses the harvest, so the panel re-reports only what
        # the LLM said and reads a misleading 100% — the bug this change fixes.
        coverage = evaluate_keyword_coverage(
            _CV,
            _JD,
            job_skills=_MATCHING + _MISSING,
            matching_skills=_MATCHING,
            missing_skills=_MISSING,
        )
        self.assertIsNone(_hit_for(coverage, "kubernetes"))
        self.assertEqual(coverage.coverage_percent, 100)


class AuthoritativeJobSkillsTest(unittest.TestCase):
    def test_explicit_job_skills_bypass_the_harvest(self) -> None:
        # When a caller has an authoritative requirements list (e.g. structured
        # job requirements in the seed path), it is used verbatim and the JD-text
        # harvest does NOT fire — so a token that is neither in the JD nor the CV
        # is still checked, and unrelated JD keywords are not injected.
        coverage = evaluate_keyword_coverage(
            _CV,
            _JD,
            job_skills=["Rust"],
            matching_skills=[],
            missing_skills=[],
        )
        keywords = {hit.keyword.lower() for hit in coverage.hits}
        self.assertEqual(keywords, {"rust"})
        rust = _hit_for(coverage, "rust")
        self.assertIsNotNone(rust)
        self.assertFalse(rust.matched)

    def test_optional_lists_default_to_empty(self) -> None:
        # matching_skills / missing_skills are optional; omitting them must not
        # raise and must yield an empty missing list rather than None handling.
        coverage = evaluate_keyword_coverage(_CV, _JD)
        self.assertEqual(coverage.missing, [])
        self.assertIsInstance(coverage.coverage_percent, int)


class KeywordStuffingThresholdTest(unittest.TestCase):
    """Locks the documented keyword-stuffing policy (both conditions required)."""

    def test_below_cv_floor_is_not_flagged(self) -> None:
        # Disproportionate to the JD (in_jd=0) but under the absolute CV floor,
        # so a lightly-used term is never flagged.
        below_floor = KEYWORD_STUFFING_MIN_CV_OCCURRENCES - 1
        self.assertEqual(
            _keyword_status(matched=True, in_jd=0, in_cv=below_floor), "matched"
        )

    def test_meets_both_conditions_is_over_used(self) -> None:
        in_jd = 1
        in_cv = KEYWORD_STUFFING_MIN_CV_OCCURRENCES  # >= floor and > in_jd * ratio
        self.assertEqual(
            _keyword_status(matched=True, in_jd=in_jd, in_cv=in_cv), "over_used"
        )

    def test_proportional_to_jd_is_not_flagged(self) -> None:
        # Heavy CV use that only matches (does not strictly exceed) the JD ratio
        # is legitimate demand, not stuffing.
        in_jd = 3
        in_cv = in_jd * KEYWORD_STUFFING_JD_RATIO  # == ratio, not strictly greater
        self.assertEqual(
            _keyword_status(matched=True, in_jd=in_jd, in_cv=in_cv), "matched"
        )

    def test_unmatched_is_missing(self) -> None:
        self.assertEqual(_keyword_status(matched=False, in_jd=5, in_cv=0), "missing")


class DisplayCapTest(unittest.TestCase):
    """Caps are presentation-only: lists truncate but totals/percent stay whole."""

    def test_hits_capped_with_full_total_preserved(self) -> None:
        skills = [f"kw{i:02d}" for i in range(MAX_KEYWORD_HITS + 6)]
        text = " ".join(skills)
        coverage = evaluate_keyword_coverage(
            candidate_text=text,
            job_description_text=text,
            job_skills=skills,
            matching_skills=skills,
            missing_skills=[],
        )
        self.assertEqual(len(coverage.hits), MAX_KEYWORD_HITS)
        self.assertEqual(coverage.hits_total, len(skills))
        # coverage_percent is computed over the FULL hit set, not the capped view.
        self.assertEqual(coverage.coverage_percent, 100)

    def test_missing_capped_with_full_total_preserved(self) -> None:
        missing = [f"gap{i:02d}" for i in range(MAX_MISSING_KEYWORDS + 5)]
        coverage = evaluate_keyword_coverage(
            candidate_text="",
            job_description_text="",
            job_skills=["python"],
            matching_skills=[],
            missing_skills=missing,
        )
        self.assertEqual(len(coverage.missing), MAX_MISSING_KEYWORDS)
        self.assertEqual(coverage.missing_total, len(missing))


class MatchingSkillVerificationTest(unittest.TestCase):
    """The trust gate (UAT M1): an LLM "matching" skill is kept only when it is
    actually verifiable in the CV — literally or via a taxonomy alias — so a
    hallucinated match never reaches the recruiter as a confirmed skill."""

    def test_hallucinated_skill_is_withheld(self) -> None:
        # The CV proves Python only; an LLM that also claims Kubernetes (the JD's
        # demand) is hallucinating against this candidate — Kubernetes is withheld,
        # Python kept. This is the recruiter's blocker line.
        verified, withheld = verify_skills_in_cv(["Python", "Kubernetes"], _CV)
        self.assertIn("Python", verified)
        self.assertIn("Kubernetes", withheld)
        self.assertNotIn("Kubernetes", verified)

    def test_taxonomy_alias_counts_as_verified(self) -> None:
        # CV writes the alias "k8s"; a claimed canonical "Kubernetes" is real and
        # must be kept — alias-aware verification, not a naive string match.
        verified, withheld = verify_skills_in_cv(
            ["Kubernetes"], "Ran production clusters on k8s for three years."
        )
        self.assertEqual(verified, ["Kubernetes"])
        self.assertEqual(withheld, [])

    def test_untaxonomized_skill_falls_back_to_literal_cv_presence(self) -> None:
        # A niche tool the taxonomy does not model is verified iff it is literally
        # in the CV; an unrelated one the CV never names is withheld.
        cv = "Built reporting on top of FrobozzDB in the data team."
        verified, withheld = verify_skills_in_cv(["FrobozzDB", "Snowflake"], cv)
        self.assertEqual(verified, ["FrobozzDB"])
        self.assertEqual(withheld, ["Snowflake"])

    def test_untaxonomized_multiword_matches_across_whitespace(self) -> None:
        # A line-wrapped / double-spaced phrase still verifies via the flexible
        # whitespace boundary match.
        cv = "We built the Frobozz\n  Engine in-house."
        verified, withheld = verify_skills_in_cv(["Frobozz Engine"], cv)
        self.assertEqual(verified, ["Frobozz Engine"])
        self.assertEqual(withheld, [])

    def test_order_preserved_and_duplicates_collapsed(self) -> None:
        verified, withheld = verify_skills_in_cv(["Python", "python", "Kubernetes"], _CV)
        self.assertEqual(verified, ["Python"])  # dup collapsed, first casing kept
        self.assertEqual(withheld, ["Kubernetes"])

    def test_empty_input_is_safe(self) -> None:
        self.assertEqual(verify_skills_in_cv([], _CV), ([], []))


class NormalizationPrimitiveDedupTest(unittest.TestCase):
    """Direction 3: ats.py now consumes the taxonomy's ONE normalization + word-
    boundary implementation. These pin that the shared primitive gives the exact
    verdicts the old ats-local regex did on the special-charactered skill edge
    cases (C++/C#/.NET/Go), so the dedup can't silently shift a match."""

    def test_normalize_delegates_to_taxonomy(self) -> None:
        # Same NFC + casefold — accents and case fold identically to the taxonomy's.
        for text in ("C++ Developer", "Registered NURSE", "Účetní", "React.JS"):
            self.assertEqual(_normalize(text), taxonomy.normalize_text(text))

    def test_special_char_skills_match_as_whole_tokens(self) -> None:
        # Present as a standalone token -> matched; buried in a larger word -> not.
        cases = [
            ("c++", "worked in c++ for years", True),
            ("c++", "c programming, not the plus", False),
            ("c#", "built services in c# and .net", True),
            ("c#", "the c language only", False),
            (".net", "shipped on .net core", True),
            (".net", "used asp.net mvc", False),  # boundary: 't' before '.' blocks it
            ("go", "go microservices at scale", True),
            ("go", "google cloud platform", False),  # never inside "google"
        ]
        for skill, cv, expected in cases:
            with self.subTest(skill=skill, cv=cv):
                self.assertEqual(_skill_in_text(_normalize(cv), _normalize(skill)), expected)

    def test_occurrences_counts_whole_tokens_only(self) -> None:
        self.assertEqual(_occurrences(_normalize("go go go, not google"), _normalize("go")), 3)
        self.assertEqual(_occurrences(_normalize("c++ c++ c"), _normalize("c++")), 2)
        self.assertEqual(_occurrences("", "go"), 0)
        self.assertEqual(_occurrences("anything", ""), 0)

    def test_empty_surface_never_matches(self) -> None:
        self.assertFalse(_skill_in_text("some cv text", ""))


if __name__ == "__main__":
    unittest.main()
