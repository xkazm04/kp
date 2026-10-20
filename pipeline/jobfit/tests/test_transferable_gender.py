"""Gender symmetry of the Czech prior-role signals in ``transferable.py``.

Czech job titles inflect for gender. ``_TRANSFERABLE_MAP`` matches surface
substrings, so a signal that only covers the masculine form credits a man and not
the woman who held the identical job: "Projektový manažer" earned project
management / delivery / stakeholder management and graded as a MODERATE domain
distance, while "Projektová manažerka" earned none of them and graded FAR — a
different potential score for the same career, off nothing but grammatical gender.

The same asymmetry existed for pedagog/pedagožka, poradce/poradkyně,
právník/právnička and voják/vojačka.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import transferable as tr
from pipeline.jobfit.profile import Evidence
from pipeline.jobfit.taxonomy import feminine_probe_forms
from pipeline.jobfit.transferable import domain_distance, map_transferable

# (masculine title, feminine title) for the same role. Every pair must produce the
# SAME meta-skills and the SAME domain distance.
GENDERED_TITLES = [
    ("Projektový manažer", "Projektová manažerka"),
    ("Pedagog na střední škole", "Pedagožka na střední škole"),
    ("Poradce pro klienty", "Poradkyně pro klienty"),
    ("Právník", "Právnička"),
    # The dictionary-standard feminine of "právník". The authored stem "právnič"
    # reaches "Právnička" and not this; the derived full form closes it.
    ("Právník", "Právnice"),
    ("Voják z povolání", "Vojačka z povolání"),
    # Already symmetric before the fix (the masculine stem is a prefix of the
    # feminine) — pinned so a future edit can't break them either.
    ("Učitel", "Učitelka"),
    ("Ředitel pobočky", "Ředitelka pobočky"),
    ("Analytik", "Analytička"),
    ("Koordinátor projektů", "Koordinátorka projektů"),
    ("Konzultant", "Konzultantka"),
]


def _evidence(title: str) -> list[Evidence]:
    return [Evidence(kind="job", title=title, text="Odpovědnost za výsledky týmu.")]


class GenderedTitleSymmetryTest(unittest.TestCase):
    def test_meta_skills_do_not_depend_on_grammatical_gender(self) -> None:
        for masculine, feminine in GENDERED_TITLES:
            with self.subTest(title=masculine):
                male = sorted(skill for skill, _src in map_transferable(_evidence(masculine)))
                female = sorted(skill for skill, _src in map_transferable(_evidence(feminine)))
                self.assertEqual(
                    male,
                    female,
                    f"{masculine!r} and {feminine!r} must transfer the same meta-skills; "
                    f"masculine-only: {sorted(set(male) - set(female))}",
                )

    def test_no_gendered_form_is_stranded_at_far(self) -> None:
        """The failure mode: the feminine title matched no signal at all, so the
        bridge was graded FAR ("shares no surface signals") while the masculine
        graded MODERATE through the meta-skill map.

        The ADJACENT signal lists (data/taxonomy.json ::adjacent_domain_signals,
        read as taxonomy.ADJACENT_DOMAIN_SIGNALS) used to carry masculine-only stems
        of their own — "Analytik" graded `adjacent` against data_ai where
        "Analytička" graded `moderate`. taxonomy.feminine_variants now derives the
        feminine stems at load, so the assertion below was STRENGTHENED from "the
        feminine is not stranded at far" to "both genders grade IDENTICALLY", which
        is the property the two layers together now guarantee.
        pipeline/jobfit/tests/test_taxonomy_gender.py pins the taxonomy layer.
        """
        for masculine, feminine in GENDERED_TITLES:
            with self.subTest(title=masculine):
                for family in ("data_ai", "product_project", "general_professional"):
                    male = domain_distance(_evidence(masculine), family)[0]
                    female = domain_distance(_evidence(feminine), family)[0]
                    self.assertNotEqual(male, "far", f"{masculine!r} vs {family}")
                    self.assertEqual(
                        female,
                        male,
                        f"{feminine!r} graded {female!r} against {family} while "
                        f"{masculine!r} graded {male!r}",
                    )

    def test_a_female_project_manager_still_earns_project_management(self) -> None:
        skills = {skill for skill, _src in map_transferable(_evidence("Projektová manažerka"))}
        self.assertIn("project management", skills)
        self.assertIn("stakeholder management", skills)

    def test_a_true_beginner_still_transfers_nothing(self) -> None:
        # The credit is gated on job/internship evidence; the widened signals must
        # not start crediting a candidate with no prior professional role.
        student = [Evidence(kind="project", title="Projektová práce", text="Školní projekt.")]
        self.assertEqual(map_transferable(student), [])
        self.assertEqual(domain_distance(student, "data_ai")[0], "far")


def _skills(title: str, text: str = "Odpovědnost za výsledky týmu.") -> set[str]:
    return {skill for skill, _src in map_transferable([Evidence(kind="job", title=title, text=text)])}


def _live_signals() -> set[str]:
    return {sig for signals, _skills in tr._TRANSFERABLE_MAP for sig in signals}


# Inflected feminine text: a CV says "praxe pedagožky", not "pedagožka". The map
# matches by raw substring, so only the authored STEMS reach these case forms — the
# derived full nominatives alone would not. The derivation is additive for exactly
# this reason; these pairs fail the moment a stem leaves the authored map.
INFLECTED_TITLES = [
    ("Praxe pedagoga", "Praxe pedagožky"),
    ("Práce právníka", "Práce právničky"),
    ("Služba vojáka", "Služba vojačky"),
]


class DerivedFeminineFormsTest(unittest.TestCase):
    """The map's feminine forms are DERIVED from taxonomy.feminine_probe_forms."""

    def test_pravnice_earns_what_pravnik_and_pravnicka_earn(self) -> None:
        feminine = _skills("Právnice")
        for skill in ("analytical thinking", "attention to detail", "negotiation"):
            self.assertIn(skill, feminine)
        self.assertEqual(feminine, _skills("Právník"))
        self.assertEqual(feminine, _skills("Právnička"))

    def test_the_derivation_uses_full_words_not_stems(self) -> None:
        # The stem "právnic" (feminine_variants) would substring-hit
        # "právnických osob" and credit every accountant with negotiation.
        self.assertNotIn("negotiation", _skills("Účetní", "Účetnictví právnických osob"))
        self.assertNotIn("právnic", _live_signals())

    def test_english_and_non_agent_signals_derive_nothing(self) -> None:
        for sig in ("teacher", "manager", "lead", "account", "controller", "audit", "pr ", "head of"):
            with self.subTest(signal=sig):
                self.assertEqual(tr.feminine_signal_forms(sig), ())
        # The authored breadth is preserved group by group, in order: derivation
        # only APPENDS, it never drops or reorders an authored signal.
        self.assertEqual(len(tr._TRANSFERABLE_MAP), len(tr._AUTHORED_TRANSFERABLE_MAP))
        for (derived, d_skills), (authored, a_skills) in zip(
            tr._TRANSFERABLE_MAP, tr._AUTHORED_TRANSFERABLE_MAP
        ):
            self.assertEqual(derived[: len(authored)], authored)
            self.assertEqual(d_skills, a_skills)
            additions = derived[len(authored):]
            expected = {f for sig in authored for f in tr.feminine_signal_forms(sig)}
            self.assertEqual(set(additions), expected - set(authored))

    def test_the_derivation_is_additive_and_keeps_the_authored_stems(self) -> None:
        authored = {s for sigs, _ in tr._AUTHORED_TRANSFERABLE_MAP for s in sigs}
        for stem in ("pedagož", "právnič", "vojačk", "poradkyn"):
            self.assertIn(stem, authored)
            self.assertIn(stem, _live_signals())
        for full in ("pedagožka", "právnice", "právnička", "vojačka"):
            self.assertIn(full, _live_signals())
        # "poradkyn" is a declared exception: the probe vocabulary has no
        # -ce -> -kyně rule, so it can only ever be authored.
        self.assertEqual(feminine_probe_forms("poradce"), ())

    def test_inflected_feminine_text_keeps_its_skills(self) -> None:
        for masculine, feminine in INFLECTED_TITLES:
            with self.subTest(title=feminine):
                self.assertTrue(_skills(masculine) - set(tr._GENERIC_PROFESSIONAL))
                self.assertEqual(_skills(feminine), _skills(masculine))
                self.assertEqual(
                    domain_distance(_evidence(feminine), "general_professional")[0],
                    domain_distance(_evidence(masculine), "general_professional")[0],
                )


if __name__ == "__main__":
    unittest.main()
