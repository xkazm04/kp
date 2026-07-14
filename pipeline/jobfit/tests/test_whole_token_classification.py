"""Whole-token classifier/signal matching + data-driven language aliases
(matching-engine round 2, Direction 3).

Two guards:

1. ``taxonomy._text_contains`` — behind ``classify_role_family`` and
   ``detected_signals`` — matched its literal branch with a raw ``normalized in
   text`` substring test and NO length guard, so a 2-char taxonomy surface form
   ("ai", "go", "ml") matched INSIDE unrelated words ("email", "ongoing", "html")
   and misrouted the role family / fabricated a salary signal. It now reuses the
   ``contains_whole_token`` primitive (the same one ats.py uses), so a short surface
   must appear as a standalone token. A short-token trap proves the false match is
   gone, and a corpus snapshot proves the legitimate classifications are unchanged.

2. ``matching._LANG_ALIASES`` was a hardcoded 4-language dict; it now loads from
   ``data/taxonomy.json::language_aliases`` (``taxonomy.LANGUAGE_ALIASES``) with a
   validation guard, byte-identical to the original four buckets.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import _LANG_ALIASES, _has_language
from pipeline.jobfit.taxonomy import (
    LANGUAGE_ALIASES,
    classify_role_family,
    contains_whole_token,
    detected_signals,
    normalize_text,
)


class ShortTokenTrapTest(unittest.TestCase):
    """A 2-char taxonomy surface form must not match inside an unrelated word."""

    def test_ai_signal_not_fabricated_from_email_and_training(self) -> None:
        # "ai" is a real salary/role surface (data_ai + salary_signal "ai"), and it
        # is a raw substring of "email", "campaign" and "training". Pre-fix these
        # falsely produced an "ai" signal; whole-token matching drops it.
        signals = detected_signals(
            "Email marketing campaign manager running ongoing training sessions."
        )
        self.assertNotIn("ai", signals)

    def test_email_marketing_role_does_not_misroute_to_data_ai(self) -> None:
        # Pre-fix, the stray "ai" (email/campaign/training) + "go" (ongoing/goals)
        # substrings pulled this marketing/PM role into data_ai. It must now route to
        # a people/marketing family instead.
        family = classify_role_family(
            [], "Email marketing campaign manager driving ongoing sales goals."
        )
        self.assertNotEqual(family, "data_ai")

    def test_go_not_matched_inside_ongoing_or_algorithm(self) -> None:
        # "go" (software_engineering vote) is a substring of "ongoing"/"algorithm"
        # but must not vote software on a non-tech sentence.
        self.assertFalse(
            contains_whole_token(normalize_text("ongoing algorithm goals"), "go")
        )

    def test_standalone_ai_is_still_detected(self) -> None:
        # Non-vacuity: the fix must not over-restrict — a real standalone "AI" token
        # still produces the signal.
        self.assertIn("ai", detected_signals("Hands-on AI and ML research in Python."))


class ClassificationCorpusSnapshotTest(unittest.TestCase):
    """Pin a representative corpus's classifications so the whole-token change (and
    any future taxonomy edit) can't silently drift them. Every non-tech line routes
    to its own family and the tech lines stay tech — the seeded-corpus behaviour the
    fix preserves. The two marketing/HR lines that carried a FALSE data_ai vote
    pre-fix now route correctly (documented in the commit body)."""

    CORPUS: dict[str, str] = {
        "Registered nurse, 8 years in the ICU at a Level I trauma center; CCRN.": "healthcare_clinical",
        "Licensed electrician wiring commercial sites for a general contractor.": "skilled_trades",
        "Warehouse forklift operator and order picker at a distribution centre.": "operations_logistics",
        "Cashier and store associate at a busy retail shop for three years.": "frontline_service",
        "High-school teacher and university lecturer; faculty member since 2014.": "education_academic",
        "Senior accountant and auditor preparing month-end financial statements.": "finance_accounting",
        "Research scientist with a PhD running a wet lab; postdoctoral in biochemistry.": "life_sciences_research",
        "Account manager and sales representative exceeding B2B quota.": "sales_marketing",
        "Graphic designer and art director building brand campaigns.": "creative_design",
        "Customer support agent on the help desk resolving tickets.": "customer_support",
        "Corporate lawyer and legal counsel advising on commercial contracts.": "legal_compliance",
        "Talent acquisition partner and recruiter hiring across teams.": "hr_people",
        "Senior software engineer building backend services in Python and Go.": "software_engineering",
        "Data scientist doing ML and AI research with SQL and Python.": "data_ai",
        "Experienced professional seeking a new opportunity.": "general_professional",
    }

    def test_corpus_classifications_are_stable(self) -> None:
        actual = {text: classify_role_family([], text) for text in self.CORPUS}
        self.assertEqual(actual, self.CORPUS)


class DataDrivenLanguageAliasesTest(unittest.TestCase):
    def test_matching_reads_the_taxonomy_map(self) -> None:
        self.assertIs(_LANG_ALIASES, LANGUAGE_ALIASES)

    def test_four_buckets_are_byte_identical_to_the_original(self) -> None:
        self.assertEqual(
            LANGUAGE_ALIASES,
            {
                "english": ("english", "angli", "en "),
                "czech": ("czech", "česk", "cesk", "čeština", "cestina"),
                "german": ("german", "deutsch", "němč", "nemc"),
                "slovak": ("slovak", "slovenš", "slovens"),
            },
        )

    def test_has_language_still_resolves_aliases(self) -> None:
        self.assertTrue(_has_language(["Czech (native)"], "Czech"))
        self.assertTrue(_has_language(["Deutsch B2"], "German"))
        self.assertFalse(_has_language(["English"], "Czech"))

    def test_unbucketed_language_falls_back_to_raw_matching(self) -> None:
        # A language with no bucket (e.g. French) still matches its raw requirement
        # string, so the KO filter degrades gracefully rather than always failing.
        self.assertTrue(_has_language(["French C1"], "French"))
        self.assertFalse(_has_language(["English"], "French"))


if __name__ == "__main__":
    unittest.main()
