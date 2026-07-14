"""The taxonomy authoring harness must CATCH planted defects.

These feed :func:`lint_taxonomy` synthetic bad terms and assert each defect is
reported. If the lint stops catching one of these, a real authoring mistake in
``data/taxonomy.json`` would slip through silently — which is exactly the
instrumentation gap the harness exists to close.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy_check as tc

_FAMILIES = frozenset({"software_engineering", "finance_accounting"})
_SIGNALS = frozenset({"english", "leadership"})


def _lint(terms, **kw):
    tax = {"terms": terms, "salary_signals": {k: {} for k in _SIGNALS}}
    kw.setdefault("families", _FAMILIES)
    return tc.lint_taxonomy(tax, **kw)


def _good_term(tid="alpha", **over):
    term = {
        "id": tid,
        "match": [tid, f"{tid}-cs"],
        "categories": ["skill"],
        "role_family_votes": {"software_engineering": 1},
    }
    term.update(over)
    return term


class LintCatchesDefectsTest(unittest.TestCase):
    def test_baseline_good_terms_pass(self) -> None:
        res = _lint([_good_term("alpha"), _good_term("beta")])
        self.assertTrue(res.ok, res.errors)
        self.assertEqual(res.warnings, [])

    def test_dangling_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["ghost"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("dangling parent" in e and "ghost" in e for e in res.errors), res.errors)

    def test_duplicate_id_is_caught(self) -> None:
        res = _lint([_good_term("dup"), _good_term("dup")])
        self.assertFalse(res.ok)
        self.assertTrue(any("duplicate term id" in e for e in res.errors), res.errors)

    def test_vote_to_unknown_family_is_caught(self) -> None:
        res = _lint([_good_term("alpha", role_family_votes={"made_up_family": 1})])
        self.assertFalse(res.ok)
        self.assertTrue(any("unknown family" in e and "made_up_family" in e for e in res.errors), res.errors)

    def test_single_surface_form_is_flagged(self) -> None:
        # Monolingual term: a WARNING (many legitimate proper nouns are monolingual),
        # but it must be surfaced so bilingual coverage stays measurable.
        res = _lint([_good_term("alpha", match=["alpha"])])
        self.assertTrue(res.ok, res.errors)  # not an error
        self.assertTrue(any("single surface form" in w for w in res.warnings), res.warnings)

    def test_empty_match_is_caught(self) -> None:
        res = _lint([_good_term("alpha", match=[])])
        self.assertFalse(res.ok)
        self.assertTrue(any("'match' must be a non-empty list" in e for e in res.errors), res.errors)

    def test_unknown_category_is_caught(self) -> None:
        res = _lint([_good_term("alpha", categories=["skill", "not_a_category"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("unknown category" in e for e in res.errors), res.errors)

    def test_bad_salary_signal_is_caught(self) -> None:
        res = _lint([_good_term("alpha", salary_signal="nonexistent_signal")])
        self.assertFalse(res.ok)
        self.assertTrue(any("salary_signal" in e and "nonexistent_signal" in e for e in res.errors), res.errors)

    def test_within_term_duplicate_surface_is_caught(self) -> None:
        # Two forms that normalize to the same value (case/diacritic fold).
        res = _lint([_good_term("alpha", match=["Java", "java"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("duplicate normalized value" in e for e in res.errors), res.errors)

    def test_self_parent_is_caught(self) -> None:
        res = _lint([_good_term("alpha", parents=["alpha"])])
        self.assertFalse(res.ok)
        self.assertTrue(any("its own parent" in e for e in res.errors), res.errors)


if __name__ == "__main__":
    unittest.main()
