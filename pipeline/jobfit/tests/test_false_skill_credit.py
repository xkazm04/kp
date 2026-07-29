"""The compact-fallback must not award skills nobody claimed.

``taxonomy._text_contains`` falls back — for surface forms whose compact form is
>= 3 chars — to matching against the text with every non-word character stripped
(one giant spaceless blob). That fallback exists for a real reason: a JD spells
"Node.js" as "nodejs", "CI/CD" as "cicd", "cross-selling" as "crossselling", and
those are the SAME concept written without its separators.

Unguarded, though, it degenerated into a raw substring test over that blob and
handed out free skill credit in the DETERMINISTIC core — silently and repeatably:

    detected_skills("Driven by curiosity and a love of learning")   -> ['ios']
    detected_skills("We use PostgreSQL heavily")                    -> ['postgresql', 'sql']
    detected_skills("Experienced in upselling to enterprise accounts")
                                                                    -> ['selling', 'upselling']
    detected_skills("Kubernetes, OpenShift, Helm")   -> ['.net', 'helm', 'kubernetes', 'sop']

Every one of those inflates a candidate's skill score against a JD they do not
match. The guard pins the fallback to the text's WORD GRID: a compact match must
start where a word starts and end where a word ends (with a suffix-inflection
relaxation for single plain-token surfaces, so Czech "ve sparku" still means
Spark). These tests are the four proofs above, plus the non-vacuity cases that
would break if the guard were merely "drop the fallback".
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.taxonomy import detected_skills


def _skills(text: str) -> set[str]:
    return set(detected_skills(text))


class FalseSkillCreditTest(unittest.TestCase):
    """The four proven false-credit paths — bogus skill gone, real skill kept."""

    def test_curiosity_does_not_award_ios(self) -> None:
        self.assertNotIn("ios", _skills("Driven by curiosity and a love of learning"))

    def test_postgresql_does_not_award_bare_sql(self) -> None:
        found = _skills("We use PostgreSQL heavily")
        self.assertNotIn("sql", found)
        self.assertIn("postgresql", found)  # non-vacuity: the real skill still lands

    def test_upselling_does_not_award_selling(self) -> None:
        found = _skills("Experienced in upselling to enterprise accounts")
        self.assertNotIn("selling", found)
        self.assertIn("upselling", found)

    def test_kubernetes_stack_does_not_award_dotnet_or_sop(self) -> None:
        # ".net" (compact "net") sits inside "kuberNETes"; "sop" spans the
        # "kuberneteS OPenshift" boundary in the compacted blob.
        found = _skills("Kubernetes, OpenShift, Helm")
        self.assertNotIn(".net", found)
        self.assertNotIn("sop", found)
        self.assertIn("kubernetes", found)
        self.assertIn("helm", found)


class CompactFallbackStillWorksTest(unittest.TestCase):
    """Non-vacuity: the guard narrows the fallback, it does not remove it."""

    def test_separatorless_spelling_still_matches(self) -> None:
        # The three verified-benign surfaces (BENIGN_COMPACT_SURFACES in
        # taxonomy_check): the same concept spelled without its separators.
        self.assertIn("node.js", _skills("Backend in nodejs and Postgres"))
        self.assertIn("ci/cd", _skills("Owns cicd pipelines end to end"))
        self.assertIn("cross-selling", _skills("Strong crossselling record in retail"))

    def test_separated_spelling_still_matches(self) -> None:
        self.assertIn("node.js", _skills("Backend in Node.js and Postgres"))
        self.assertIn(".net", _skills("ASP.NET Core services on Azure"))

    def test_czech_suffix_inflection_still_matches(self) -> None:
        # Czech inflects by suffix, so a plain single-token surface may finish inside
        # the word it started — "ve sparku"/"v pythonu" are Spark/Python.
        self.assertIn("python", _skills("Vývoj transformací ve sparku a pythonu."))
        self.assertIn("spark", _skills("Vývoj transformací ve sparku a pythonu."))

    def test_inflection_relaxation_does_not_extend_to_punctuated_surfaces(self) -> None:
        # ".net" -> compact "net" is a lossy spelling, so it gets NO inflection
        # relaxation: it must land on a whole "net" token, never inside "networking".
        self.assertNotIn(".net", _skills("Networking and stakeholder management"))


if __name__ == "__main__":
    unittest.main()
