"""Czech gender parity of the taxonomy's own surface forms.

Czech job titles, seniority adjectives and agent nouns inflect for gender, and
every matcher in ``taxonomy.py`` works on surface substrings/whole tokens. A
surface written only in the masculine therefore classifies the man and not the
woman who wrote the identical CV. Measured before ``feminine_variants`` existed:

* ``detected_seniority_levels("zkušený samostatný specialista")`` -> {senior, medior}
  but ``…("zkušená samostatná specialistka")`` -> set(), which ``build_profile``
  turns into `senior` vs `junior` and ``ko_filter`` turns into a HARD knockout of
  the woman from every senior role.
* ``classify_role_family("Grafik")`` -> creative_design,
  ``classify_role_family("Grafička")`` -> general_professional (and the same for
  pedagog/pedagožka, právník/právnička, číšník/číšnice, zámečník/zámečnice,
  skladník/skladnice).
* ``domain_distance("Analytik", "data_ai")`` -> adjacent,
  ``…("Analytička", …)`` -> moderate — the grade that lifts a switcher's
  potential floor.

Most masculine forms need no entry: the masculine is a PREFIX of the feminine
("učitel" in "učitelka") and the matchers tolerate the suffix. These tests pin the
stem-CHANGING cases, which no suffix tolerance can bridge, and pin the negative
control — the derivation must not widen an English or non-agent surface.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy_check as tc
from pipeline.jobfit.jobs import Job
from pipeline.jobfit.matching import MatchCandidate, ko_filter
from pipeline.jobfit.profile import Evidence
from pipeline.jobfit.profiling import build_profile
from pipeline.jobfit.taxonomy import (
    ROLE_FAMILIES,
    classify_role_family,
    detected_seniority_levels,
    feminine_variants,
)
from pipeline.jobfit.transferable import domain_distance

# (masculine, feminine) for the same word. Every pair must classify identically.
SENIORITY_WORDS = [
    ("zkušený", "zkušená"),
    ("samostatný", "samostatná"),
    ("specialista", "specialistka"),
    ("stážista", "stážistka"),
    ("začátečník", "začátečnice"),
    # already symmetric before the rule (hand-authored or prefix-covered) — pinned
    # so a future edit cannot break them either.
    ("student", "studentka"),
    ("absolvent", "absolventka"),
    ("praktikant", "praktikantka"),
]

ROLE_TITLES = [
    ("Analytik", "Analytička"),
    ("Technik", "Technička"),
    ("Pedagog", "Pedagožka"),
    ("Právník", "Právnička"),
    ("Číšník", "Číšnice"),
    ("Zámečník", "Zámečnice"),
    ("Grafik", "Grafička"),
    ("Biolog", "Bioložka"),
    ("Skladník", "Skladnice"),
    ("Logistik", "Logistička"),
    ("Personalista", "Personalistka"),
    ("Finanční analytik", "Finanční analytička"),
    ("Vědecký pracovník", "Vědecká pracovnice"),
    # prefix-covered controls
    ("Učitel", "Učitelka"),
    ("Prodavač", "Prodavačka"),
    ("Lékař", "Lékařka"),
]


class SeniorityIsNotGenderedTest(unittest.TestCase):
    def test_seniority_markers_classify_both_genders(self) -> None:
        for masculine, feminine in SENIORITY_WORDS:
            with self.subTest(word=masculine):
                self.assertEqual(
                    detected_seniority_levels(masculine),
                    detected_seniority_levels(feminine),
                    f"{masculine!r} and {feminine!r} must read as the same seniority",
                )

    def test_a_female_cv_is_not_knocked_out_of_a_senior_role(self) -> None:
        """The consequential failure: ko_filter's seniority gap is a HARD gate, so a
        feminine-written CV inferred `junior` was removed from every senior role
        before it was ever scored, while its masculine twin passed."""
        job = Job.model_validate(
            {
                "id": "j1",
                "title": "Senior Data Analyst",
                "company": "X",
                "location": "Praha",
                "workMode": "hybrid",
                "seniority": "senior",
                "roleFamily": "data_ai",
                "description": "Senior analytik.",
                "requirements": [{"skill": "SQL", "kind": "must_have"}],
                "languages": [],
                "minEducation": "none",
            }
        )
        cvs = {
            "masculine": "Jan Novák\nZkušený samostatný specialista pro oblast reportingu.\nPraha",
            "feminine": "Jana Nováková\nZkušená samostatná specialistka pro oblast reportingu.\nPraha",
        }
        seen: dict[str, tuple[str, bool]] = {}
        for who, text in cvs.items():
            profile = build_profile(text)
            candidate = MatchCandidate(
                seniority=profile.current_seniority,
                role_family="data_ai",
                skills=["SQL"],
                archetype="bau",
            )
            passed, _reasons = ko_filter(candidate, job)
            seen[who] = (profile.current_seniority, passed)
        self.assertEqual(seen["masculine"], ("senior", True))
        self.assertEqual(
            seen["feminine"],
            ("senior", True),
            "the same CV written in the feminine must infer the same seniority and "
            f"survive the same KO gate; got {seen['feminine']}",
        )


class RoleFamilyIsNotGenderedTest(unittest.TestCase):
    def test_titles_route_to_the_same_family_in_both_genders(self) -> None:
        for masculine, feminine in ROLE_TITLES:
            with self.subTest(title=masculine):
                self.assertEqual(
                    classify_role_family([], masculine),
                    classify_role_family([], feminine),
                    f"{masculine!r} and {feminine!r} must route to the same role family",
                )


class DomainDistanceIsNotGenderedTest(unittest.TestCase):
    """``ADJACENT`` is the only grade that lifts ``compute_potential``'s foundation
    floor, so a masculine-only signal costs the woman potential AND the "shorter
    bridge" narrative for the identical career."""

    def test_prior_role_titles_grade_the_same_in_both_genders(self) -> None:
        def evidence(title: str) -> list[Evidence]:
            return [Evidence(kind="job", title=title, text="Praxe v oboru.")]

        for masculine, feminine in ROLE_TITLES:
            for family in ROLE_FAMILIES:
                with self.subTest(title=masculine, family=family):
                    self.assertEqual(
                        domain_distance(evidence(masculine), family)[0],
                        domain_distance(evidence(feminine), family)[0],
                        f"{masculine!r} vs {feminine!r} graded differently against {family}",
                    )


class DerivationDoesNotOverReachTest(unittest.TestCase):
    """The derivation must add ONLY feminine forms. The regression it guards against
    is real: an earlier draft treated the short-i "-nik" tail as the "-ník" class and
    derived the stem "technic" from "technik", which matches the ENGLISH "technical" /
    "technician" and would have widened `skilled_trades` far beyond gender parity."""

    def test_english_and_non_agent_surfaces_derive_nothing(self) -> None:
        for surface in (
            "engineer",
            "technician",
            "reporting",
            "marketing",
            "controlling",
            "data",
            "audit",
            "sql",
            "supply chain",
            "čerstvý absolvent",  # head noun does not inflect -> no half-inflected phrase
        ):
            with self.subTest(surface=surface):
                self.assertEqual(feminine_variants(surface), ())

    def test_technik_derives_only_the_feminine_stem(self) -> None:
        self.assertEqual(feminine_variants("technik"), ("technič",))
        self.assertNotIn("technic", feminine_variants("technik"))


class GenderGapScanTest(unittest.TestCase):
    """The harness must be able to FAIL — planted defects have to be reported."""

    def test_the_live_taxonomy_has_no_gender_gaps(self) -> None:
        gaps = tc.scan_gender_gaps(tc.load_taxonomy())
        self.assertEqual([g.describe() for g in gaps], [])

    def test_the_scan_is_not_vacuous_on_the_live_taxonomy(self) -> None:
        # Without the derived forms the SAME data reports real gaps — so a clean run
        # above means the rule works, not that the scan looks at nothing.
        pre = tc.scan_gender_gaps(tc.load_taxonomy(), derive=False)
        self.assertGreater(len(pre), 20)
        described = " ".join(g.describe() for g in pre)
        for expected in ("zkušená", "specialistka", "grafička", "pedagožka", "analytička"):
            self.assertIn(expected, described)

    def test_a_planted_masculine_only_term_is_reported(self) -> None:
        planted = {
            "terms": [{"id": "planted", "match": ["zámečník"], "categories": ["role_title"]}],
            "adjacent_domain_signals": {"skilled_trades": ["zámečník"]},
        }
        gaps = tc.scan_gender_gaps(planted, derive=False)
        self.assertTrue(gaps, "the scan must report a masculine-only surface")
        self.assertTrue(any(g.where == "terms[planted]" for g in gaps), gaps)
        self.assertTrue(
            any(g.where == "adjacent_domain_signals[skilled_trades]" for g in gaps), gaps
        )
        # …and the derivation closes exactly that planted gap.
        self.assertEqual(tc.scan_gender_gaps(planted, derive=True), [])

    def test_a_term_already_carrying_its_feminine_is_not_reported(self) -> None:
        # role_physician's data authors wrote both forms by hand; no gap either way.
        authored = {"terms": [{"id": "ok", "match": ["lékař", "lékařka"]}]}
        self.assertEqual(tc.scan_gender_gaps(authored, derive=False), [])


if __name__ == "__main__":
    unittest.main()
