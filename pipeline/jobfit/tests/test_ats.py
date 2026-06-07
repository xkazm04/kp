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

from pipeline.jobfit.ats import evaluate_keyword_coverage
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


if __name__ == "__main__":
    unittest.main()
