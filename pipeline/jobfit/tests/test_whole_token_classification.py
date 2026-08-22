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

3. ``matching._WORD_RE`` — the splitter behind the SAME whole-token promise, one
   layer down in ``score_personal``'s description-overlap term. Guard 1 above only
   ever probed ``taxonomy._text_contains``, so the ASCII splitter (``[a-z0-9]+``)
   that treated every Czech diacritic as a word SEPARATOR sailed through this file:
   "podávání léků" shredded into ``{pod, v, n, l, k}``, fragments that trivially all
   appear as standalone runs in Czech prose, so a clinical skill "overlapped" an iOS
   ad. See ``UnicodeWordSplitterTest`` below.
"""

from __future__ import annotations

import re
import unittest

from pipeline.jobfit.matching import (
    _LANG_ALIASES,
    _WORD_RE,
    _description_words,
    _has_language,
    _term_in_words,
)
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



class UnicodeWordSplitterTest(unittest.TestCase):
    """``matching._WORD_RE`` must split on WORD characters, not on ASCII letters.

    The whole-token promise this file guards for ``taxonomy._text_contains`` has a
    twin one layer down: ``score_personal``'s description-overlap term reduces both
    the ad and each candidate token to whole words via ``_WORD_RE`` and requires
    every part to appear as a standalone word. Under the former ASCII pattern
    (``[a-z0-9]+``) every Czech diacritic was a SEPARATOR, so an accented skill was
    shredded into one- and two-letter fragments that appear in any Czech prose —
    fragment matching, i.e. exactly the substring defect the whole-token rule
    exists to remove, left open for every accented language.

    The trap is deliberately built so the ASCII fragments ARE present in the ad
    (``test_the_trap_is_live``): the guard only means something if the pre-fix
    splitter would really have scored a hit here.
    """

    # A Czech iOS ad. It shares no word with a nursing skill, but its ASCII letter
    # runs do contain pod / v / n / l / k (podíl, v, náš, čistý, kód).
    AD_CZ = (
        "Náš tým staví iOS aplikace. Nabízíme podíl na produktu, "
        "kávu zdarma a čistý kód v Swiftu."
    )
    CLINICAL_SKILL = "podávání léků"  # administering medication

    def test_accented_surfaces_tokenize_to_whole_words(self) -> None:
        self.assertEqual(_WORD_RE.findall(self.CLINICAL_SKILL), ["podávání", "léků"])
        self.assertEqual(_WORD_RE.findall("vývojář"), ["vývojář"])
        self.assertEqual(_WORD_RE.findall("ošetřovatelství"), ["ošetřovatelství"])

    def test_the_trap_is_live(self) -> None:
        # Non-vacuity: under the pre-fix ASCII splitter the skill's fragments really
        # are all standalone tokens of this ad, so the false overlap below would fire.
        ascii_words = set(re.findall(r"[a-z0-9]+", self.AD_CZ.casefold()))
        ascii_parts = re.findall(r"[a-z0-9]+", self.CLINICAL_SKILL.casefold())
        self.assertEqual(ascii_parts, ["pod", "v", "n", "l", "k"])
        self.assertTrue(set(ascii_parts) <= ascii_words, sorted(ascii_words))

    def test_a_clinical_czech_skill_earns_no_overlap_on_an_ios_ad(self) -> None:
        self.assertFalse(_term_in_words(self.CLINICAL_SKILL, _description_words(self.AD_CZ)))

    def test_a_genuinely_present_czech_skill_still_matches(self) -> None:
        # No over-restriction: the accented multi-word skill the ad DOES name still hits.
        self.assertTrue(_term_in_words("čistý kód", _description_words(self.AD_CZ)))
        self.assertTrue(_term_in_words("Swiftu", _description_words(self.AD_CZ)))

    def test_english_substring_matching_stays_closed(self) -> None:
        # The English half of the same rule, pinned alongside: "Rust" must not hit
        # the "rust" inside "trust".
        self.assertFalse(_term_in_words("rust", _description_words("A team you can trust.")))
        self.assertTrue(_term_in_words("rust", _description_words("We write Rust.")))


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

    def test_original_four_buckets_are_byte_identical(self) -> None:
        # The original four buckets must stay byte-identical; the EU-language
        # additions extend the map, they don't perturb what already worked.
        for lang, needles in {
            "english": ("english", "angli", "en "),
            "czech": ("czech", "česk", "cesk", "čeština", "cestina"),
            "german": ("german", "deutsch", "němč", "nemc"),
            "slovak": ("slovak", "slovenš", "slovens"),
        }.items():
            self.assertEqual(LANGUAGE_ALIASES[lang], needles)

    def test_eu_languages_are_bucketed(self) -> None:
        # The practical EU languages now carry buckets so a native surface form
        # satisfies an English requirement (see matching's KO-filter test).
        for lang in ("polish", "hungarian", "romanian", "french", "spanish", "italian", "dutch", "ukrainian"):
            self.assertIn(lang, LANGUAGE_ALIASES)

    def test_has_language_still_resolves_aliases(self) -> None:
        self.assertTrue(_has_language(["Czech (native)"], "Czech"))
        self.assertTrue(_has_language(["Deutsch B2"], "German"))
        self.assertFalse(_has_language(["English"], "Czech"))

    def test_boundary_alias_matches_at_the_end_of_the_blob(self) -> None:
        # The "en " alias carries a trailing space as a WORD BOUNDARY (so the ISO
        # code can't match inside "german"/"french"/"slovenian"). The candidate
        # blob is padded on both ends so that boundary is satisfiable at the END
        # of the list too — otherwise a candidate whose languages END with the code
        # was hard-KO'd out of the pool, while the SAME two entries in the other
        # order passed. Position must never decide a knock-out.
        self.assertTrue(_has_language(["EN"], "English"))
        self.assertTrue(_has_language(["Czech", "EN"], "English"))
        self.assertTrue(_has_language(["EN", "Czech"], "English"))
        # The boundary still holds: the code must not match inside another language.
        for other in ("German", "French", "Slovenian"):
            self.assertFalse(_has_language([other], "English"))

    def test_unbucketed_language_falls_back_to_raw_matching(self) -> None:
        # A language with no bucket (e.g. Portuguese) still matches its raw
        # requirement string, so the KO filter degrades gracefully rather than
        # always failing.
        self.assertTrue(_has_language(["Portuguese C1"], "Portuguese"))
        self.assertFalse(_has_language(["English"], "Portuguese"))

    def test_unmodelled_language_matches_only_a_literal_substring(self) -> None:
        # LANGUAGE_ALIASES has 12 curated buckets; "portuguese" is NOT one of them.
        # The honest, documented fallback (matching._has_language): the requirement
        # matches ONLY on a literal substring of the candidate's language blob — there
        # is NO cross-lingual alias expansion. So the native surface form ("português")
        # and the ISO code ("pt") do NOT satisfy a "Portuguese" requirement, only the
        # English name literally present does. This pins the behaviour as-is; modelling
        # the language properly means adding a bucket in taxonomy.json::language_aliases,
        # not changing this fallback.
        self.assertNotIn("portuguese", LANGUAGE_ALIASES)
        self.assertTrue(_has_language(["Portuguese (native)"], "Portuguese"))
        # Native form / ISO code are unmodelled — no bucket expands them.
        self.assertFalse(_has_language(["Português nativo"], "Portuguese"))
        self.assertFalse(_has_language(["PT C2"], "Portuguese"))


if __name__ == "__main__":
    unittest.main()
