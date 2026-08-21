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

from pipeline.jobfit.profile import Evidence
from pipeline.jobfit.transferable import domain_distance, map_transferable

# (masculine title, feminine title) for the same role. Every pair must produce the
# SAME meta-skills and the SAME domain distance.
GENDERED_TITLES = [
    ("Projektový manažer", "Projektová manažerka"),
    ("Pedagog na střední škole", "Pedagožka na střední škole"),
    ("Poradce pro klienty", "Poradkyně pro klienty"),
    ("Právník", "Právnička"),
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

        Only the _TRANSFERABLE_MAP layer is asserted here. The ADJACENT signal
        lists live in data/taxonomy.json (taxonomy.ADJACENT_DOMAIN_SIGNALS) and
        still carry masculine-only stems of their own — "Analytik" grades
        `adjacent` against data_ai where "Analytička" grades `moderate` — which is
        that file's fix to make, not this one's.
        """
        for masculine, feminine in GENDERED_TITLES:
            with self.subTest(title=masculine):
                for family in ("data_ai", "product_project", "general_professional"):
                    male = domain_distance(_evidence(masculine), family)[0]
                    female = domain_distance(_evidence(feminine), family)[0]
                    self.assertNotEqual(male, "far", f"{masculine!r} vs {family}")
                    self.assertNotEqual(
                        female,
                        "far",
                        f"{feminine!r} graded 'far' against {family} while {masculine!r} graded {male!r}",
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


if __name__ == "__main__":
    unittest.main()
